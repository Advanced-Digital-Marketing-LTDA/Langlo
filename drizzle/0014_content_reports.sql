CREATE TABLE `content_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`submission_key` text NOT NULL,
	`content_version_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`language` text NOT NULL,
	`question_id` text,
	`category` text NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_version_id`,`skill_id`,`language`) REFERENCES `content_versions`(`id`,`skill_id`,`language`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`question_id`,`content_version_id`,`skill_id`,`language`) REFERENCES `questions`(`id`,`content_version_id`,`skill_id`,`language`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "content_reports_category" CHECK("content_reports"."category" IN ('incorrect-answer', 'unclear', 'other')),
	CONSTRAINT "content_reports_comment" CHECK(length("content_reports"."comment") <= 1000 AND instr("content_reports"."comment", char(0)) = 0),
	CONSTRAINT "content_reports_submission" CHECK(length(trim("content_reports"."submission_key")) BETWEEN 1 AND 256)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_reports_owner_submission` ON `content_reports` (`owner_id`,`submission_key`);--> statement-breakpoint
CREATE INDEX `content_reports_owner_created` ON `content_reports` (`owner_id`,`created_at`);