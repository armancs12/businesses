import { relations } from "drizzle-orm";
import { DrizzleD1Database } from "drizzle-orm/d1";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export type QuestionAnswer = {
    question: string;
    answer: string;
}

export type Database = DrizzleD1Database<Schema>;

export type Schema = typeof schema;

export type DbBusiness = typeof businesses.$inferSelect;

export type DbBusinessTip = typeof businessTips.$inferSelect;

export type DbBusinessTag = typeof businessTags.$inferSelect;

export type DbBusinessGptAnalysisTask = typeof businessGptAnalysisTasks.$inferSelect;

export type BusinessCreate = Omit<DbBusiness, 'id'> & { tips: string[], tags: string[] };

export enum GPTTaskStatus {
    TODO = 'todo',
    PROCESSING = 'processing',
    OK_FOUND = 'ok_found',
    OK_NOT_FOUND = 'ok_not_found',
    ERRORED = 'errored'
}

export type AnalysisOutputJson = BusinessFound | BusinessNotFound;

type BusinessFound = {
    business_found: true;
    product_name: string;
    product_description: string;
    link_to_product?: string;
    revenue_in_usd?: number;
    detailed_tactics_used_for_revenue: string;
    technical_details?: string;
    additional_tips: string[];
    tags: string[];
};

type BusinessNotFound = {
    business_found: false;
}

export const businesses = sqliteTable("businessess", {
    id: integer("id").primaryKey(),
    scrapedUrl: text("scraped_url").notNull(),
    description: text("description"),
    name: text("name"),
    url: text("url"),
    revenue: real("revenue"),
    revenueTactics: text("revenue_tactics"),
    technicalDetails: text("technical_details")
});

export const businessRelations = relations(businesses, ({ many }) => ({
    tips: many(businessTips),
    tags: many(businessTags)
}));
  
export const businessTips = sqliteTable("business_tips", {
    id: integer("id").primaryKey(),
    businessId: integer("business_id").references(() => businesses.id).notNull(),
    tip: text("tip").notNull()
});
  
export const businessTipsRelations = relations(businessTips, ({ one }) => ({
    business: one(businesses, { fields: [businessTips.businessId], references: [businesses.id] })
}));
  
export const businessTags = sqliteTable("business_tags", {
    id: integer("id").primaryKey(),
    businessId: integer("business_id").references(() => businesses.id).notNull(),
    tag: text("tag").notNull()
});
  
export const businessTagsRelations = relations(businessTags, ({ one }) => ({
    business: one(businesses, { fields: [businessTags.businessId], references: [businesses.id] })
}));
  
export const businessGptAnalysisTasks = sqliteTable("business_gpt_analysis_tasks", {
    id: integer("id").primaryKey(),
    url: text("url").notNull(),
    platform: text("platform").notNull(),
    status: text("status").notNull(),
    inputJson: text("input_json"),
    gptResponse: text("gpt_response"),
    businessId: integer("business_id"),
    error: text("error")
});
  
export const schema = {
    businesses,
    businessTips,
    businessTags,
    businessGptAnalysisTasks,
    businessRelations,
    businessTipsRelations,
    businessTagsRelations
};

export default schema;