CREATE TABLE `content_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`curriculum_version` text NOT NULL,
	`kind` text NOT NULL,
	`skill_id` text NOT NULL,
	`content_version_id` text,
	`question_id` text,
	`previous_question_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`curriculum_version`) REFERENCES `curriculum_imports`(`curriculum_version`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "content_changes_kind" CHECK("content_changes"."kind" IN ('skill-added', 'skill-retired', 'version-added', 'question-same', 'question-changed', 'question-new', 'question-removed', 'version-quarantined'))
);
--> statement-breakpoint
CREATE INDEX `content_changes_skill` ON `content_changes` (`skill_id`);--> statement-breakpoint
ALTER TABLE `questions` ADD `lineage_key` text;--> statement-breakpoint
ALTER TABLE `skills` ADD `retired_at` integer;--> statement-breakpoint
ALTER TABLE `skills` ADD `replaced_by` text;--> statement-breakpoint
ALTER TABLE `skills` ADD `carry_progress` integer;