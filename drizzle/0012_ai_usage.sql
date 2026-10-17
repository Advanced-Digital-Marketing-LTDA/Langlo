CREATE TABLE `ai_usage` (
	`month` text NOT NULL,
	`api` text NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`month`, `api`),
	CONSTRAINT "ai_usage_month" CHECK(length("ai_usage"."month") = 7 AND "ai_usage"."month" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
	CONSTRAINT "ai_usage_api" CHECK("ai_usage"."api" IN ('decisions')),
	CONSTRAINT "ai_usage_counts" CHECK("ai_usage"."calls" >= 0 AND "ai_usage"."input_tokens" >= 0 AND "ai_usage"."output_tokens" >= 0)
);
