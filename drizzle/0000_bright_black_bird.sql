CREATE TABLE `business_gpt_analysis_tasks` (
	`id` integer PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`platform` text NOT NULL,
	`status` text NOT NULL,
	`input_json` text,
	`gpt_response` text,
	`business_id` integer,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `business_tags` (
	`id` integer PRIMARY KEY NOT NULL,
	`business_id` integer NOT NULL,
	`tag` text NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `business_tips` (
	`id` integer PRIMARY KEY NOT NULL,
	`business_id` integer NOT NULL,
	`tip` text NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `businesses` (
	`id` integer PRIMARY KEY NOT NULL,
	`scraped_url` text NOT NULL,
	`description` text,
	`name` text,
	`url` text,
	`revenue` real,
	`revenue_tactics` text,
	`technical_details` text
);
