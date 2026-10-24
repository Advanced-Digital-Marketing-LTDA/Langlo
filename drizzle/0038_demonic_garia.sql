CREATE TABLE `library_ai_usage` (
	`day` text NOT NULL,
	`owner_id` text NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`day`, `owner_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "library_ai_usage_day" CHECK(length("library_ai_usage"."day") = 10 AND "library_ai_usage"."day" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "library_ai_usage_calls" CHECK("library_ai_usage"."calls" >= 0)
);
