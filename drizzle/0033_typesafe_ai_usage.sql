PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ai_usage` (
	`month` text NOT NULL,
	`api` text NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`month`, `api`),
	CONSTRAINT "ai_usage_month" CHECK(length("__new_ai_usage"."month") = 7 AND "__new_ai_usage"."month" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
	CONSTRAINT "ai_usage_api" CHECK("__new_ai_usage"."api" IN ('decisions', 'typesafe')),
	CONSTRAINT "ai_usage_counts" CHECK("__new_ai_usage"."calls" >= 0 AND "__new_ai_usage"."input_tokens" >= 0 AND "__new_ai_usage"."output_tokens" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_ai_usage`("month", "api", "calls", "input_tokens", "output_tokens") SELECT "month", "api", "calls", "input_tokens", "output_tokens" FROM `ai_usage`;--> statement-breakpoint
DROP TABLE `ai_usage`;--> statement-breakpoint
ALTER TABLE `__new_ai_usage` RENAME TO `ai_usage`;--> statement-breakpoint
PRAGMA foreign_keys=ON;