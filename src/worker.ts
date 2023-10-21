// @ts-ignore
import promptTxt from '../resources/prompt.txt'

import schema, {
    AnalysisOutputJson,
    BusinessCreate,
    businesses,
    DbBusinessGptAnalysisTask,
    businessGptAnalysisTasks,
    Database,
    GPTTaskStatus,
    QuestionAnswer,
    Schema,
    businessTips,
    businessTags
} from "./schema";
import {eq} from "drizzle-orm";
import {drizzle, DrizzleD1Database} from "drizzle-orm/d1";
import OpenAI from "openai";
import {load as loadCheerio} from "cheerio";

type Env = {
    DATABASE: D1Database;
    OPENAI_TOKEN: string;
    DISCORD_WEBHOOK_URL: string;
};

export default {
    async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
        if (event.cron == '* * * * *') {
            const db: DrizzleD1Database<Schema> = drizzle(env.DATABASE, {schema});
            const openai = new OpenAI({ apiKey: env.OPENAI_TOKEN });
            const hook = new DiscordHook(env.DISCORD_WEBHOOK_URL);

            await scrapeAndAnalyseNextBusiness(db, openai, hook).catch(console.error);
        }
    }
};

async function scrapeAndAnalyseNextBusiness(db: Database, openai: OpenAI, hook: DiscordHook) {
    await hook.sendDiscordMessage('Scheduled job started');
    const task = await getNextAnalysisTaskFromDb(db);
    if (!task) {
        await hook.sendDiscordMessage('Scheduled job ended: No task available!');
        return;
    };

    task.status = GPTTaskStatus.PROCESSING;
    await updateAnalysisTask(db, task.id, task);
    try {
        const business = await processAnalysisTask(openai, task);
        if (business) {
            task.businessId = await insertBusinessToDb(db, business);
            task.status = GPTTaskStatus.OK_FOUND;
            await hook.sendDiscordMessage(`Scheduled job ended successfully: A new business added!`);
        } else {
            task.status = GPTTaskStatus.OK_NOT_FOUND;
            await hook.sendDiscordMessage(`Scheduled job ended successfully: A business not found!`);
        }
    } catch (err) {
        task.error = (err as Error)?.message || err?.toString() || (err as string);
        task.status = GPTTaskStatus.ERRORED;
        await hook.sendDiscordMessage(`Scheduled job failed: ${task.error}!`);
    }
    await updateAnalysisTask(db, task.id, task);
}

async function processAnalysisTask(openai: OpenAI, task: DbBusinessGptAnalysisTask): Promise<BusinessCreate | null> {
    const inputJson = await getInputJsonFromPlatform(task.platform, task.url);
    task.inputJson = JSON.stringify(inputJson);

    const prompt = businessAnalysisPrompt(inputJson);
    const response = await chatGptSendMessage(openai, prompt);
    task.gptResponse = response;

    const outputJson: AnalysisOutputJson = extractJsonFromText(response);
    if (!outputJson.business_found) return null;

    return {
        scrapedUrl: task.url,
        name: outputJson.product_name,
        description: outputJson.product_description,
        url: outputJson.link_to_product ?? null,
        revenue: outputJson.revenue_in_usd ?? null,
        revenueTactics: outputJson.detailed_tactics_used_for_revenue,
        technicalDetails: outputJson.technical_details ?? null,
        tags: outputJson.tags,
        tips: outputJson.additional_tips,
    };
}

async function getInputJsonFromPlatform(platform: string, url: string) {
    switch (platform) {
        case 'hackernews':
            return getInputJsonFromHackernews(url);
        default:
            throw new Error('Unsupported platform');
    }
}

async function getNextAnalysisTaskFromDb(db: Database) {
    try {
        return await db.query.businessGptAnalysisTasks
        .findFirst({where: eq(businessGptAnalysisTasks.status, GPTTaskStatus.TODO)});
    } catch (error) {
        return null;
    }
}

async function updateAnalysisTask(db: Database, id: number, task: Partial<DbBusinessGptAnalysisTask>) {
    await db.update(businessGptAnalysisTasks).set(task).where(eq(businessGptAnalysisTasks.id, id));
}

async function insertBusinessToDb(db: Database, business: BusinessCreate) {
    const [{ businessId }] = await db.insert(businesses)
        .values(business)
        .returning({businessId: businesses.id});

    const tips = business.tips.map(tip => ({ businessId, tip }));
    if (tips.length > 0) await db.insert(businessTips).values(tips);

    const tags = business.tags.map(tag => ({ businessId, tag }));
    if (tags.length > 0) await db.insert(businessTags).values(tags);

    return businessId;
}

function businessAnalysisPrompt(inputJson: Record<string, any>): string {
    return promptTxt.replace('{{ InputJson }}', JSON.stringify(inputJson));
}

function extractJsonFromText<T = Record<string, any>>(text: string): T {
    const startIndex = text.indexOf('{');
    const endIndex = text.lastIndexOf('}');
    if (startIndex == -1 || endIndex == -1) {
        throw new Error('No json content!');
    }

    const jsonText = text.substring(startIndex, endIndex + 1);
    return JSON.parse(jsonText);
}

async function getInputJsonFromHackernews(url: string): Promise<Record<string, any>> {
    const $ = await getPageDocument(url);

    $('.comment').each(function () {
        if ($(this).text().includes('>')) {
            const first2 = $(this).find('p').first();
            if (first2) first2.text('\n' + first2.text());
        }
    });

    const mainUser = $('.fatitem .hnuser').text().trim();
    const mainComment = $('.fatitem .comment').text().trim() || $('.fatitem .toptext').text().trim();
    const questionAnswers: Array<QuestionAnswer> = [];

    const comments = $('.comment-tree .athing');
    let lastUserCommentIndex = 0;
    for (let i = 0; i < comments.length; i++) {
        const comment = $(comments[i]);
        if (comment.find('.hnuser').text().trim() != mainUser) continue;

        const answer = comment.find('.comment').text().trim();
        let question = '';

        const indent = Number(comment.find('.ind').attr('indent'));
        for (let j = i; j >= lastUserCommentIndex; j--) {
            const prev = $(comments[j]);
            const prevIndent = Number(prev.find('.ind').attr('indent'));
            if (prevIndent < indent) {
                question = prev.find('.comment').text().trim();
                break;
            }
        }

        lastUserCommentIndex = i;
        questionAnswers.push({question, answer});
    }

    return { mainComment, questionAnswers};
}

async function getPageDocument(url: string) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error('Failed to fetch page: ' + response.status);
    }

    const html = await response.text();
    return loadCheerio(html);
}

async function chatGptSendMessage(openai: OpenAI, message: string): Promise<string> {
    const completions = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: message }]
    });
    return completions.choices[0]?.message.content ?? '';
}

class DiscordHook {
    constructor(protected webHookUrl: string) {}

    async sendDiscordMessage(message: string) {
        const body = JSON.stringify({
        "username": "Cloudflare Workers",
        "embeds": [
            {
            "title": "businesses",
            "description": message
            }
        ]
        });
        const headers = {
        "content-type": "application/json"
        };
        await fetch(this.webHookUrl, { method: "POST", body, headers }).catch(console.error);
  }
}
