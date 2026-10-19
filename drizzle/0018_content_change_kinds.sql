PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_content_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`curriculum_version` text NOT NULL,
	`kind` text NOT NULL,
	`skill_id` text NOT NULL,
	`content_version_id` text,
	`question_id` text,
	`previous_question_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`curriculum_version`) REFERENCES `curriculum_imports`(`curriculum_version`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "content_changes_kind" CHECK("__new_content_changes"."kind" IN ('skill-added', 'skill-retired', 'version-added', 'question-same', 'question-changed', 'question-new', 'question-removed', 'lesson-translation-added', 'version-quarantined'))
);
--> statement-breakpoint
INSERT INTO `__new_content_changes`("id", "curriculum_version", "kind", "skill_id", "content_version_id", "question_id", "previous_question_id", "created_at") SELECT "id", "curriculum_version", "kind", "skill_id", "content_version_id", "question_id", "previous_question_id", "created_at" FROM `content_changes`;--> statement-breakpoint
DROP TABLE `content_changes`;--> statement-breakpoint
ALTER TABLE `__new_content_changes` RENAME TO `content_changes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `content_changes_skill` ON `content_changes` (`skill_id`);