ALTER TABLE `native_flashcard_notes` ADD `explanation` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `native_flashcard_notes` ADD `source_skill_id` text;--> statement-breakpoint
ALTER TABLE `native_flashcard_notes` ADD `source_content_version_id` text;--> statement-breakpoint
ALTER TABLE `native_flashcard_notes` ADD `source_attempt_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `native_flashcard_notes_owner_source_attempt_unique` ON `native_flashcard_notes` (`owner_id`,`source_attempt_id`) WHERE "native_flashcard_notes"."source_attempt_id" IS NOT NULL;