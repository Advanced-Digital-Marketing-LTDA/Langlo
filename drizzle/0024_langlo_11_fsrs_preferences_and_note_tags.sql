CREATE TABLE `native_flashcard_preferences` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`desired_retention` integer DEFAULT 90 NOT NULL,
	`new_card_preset` text DEFAULT '1m+10m' NOT NULL,
	`relearning_preset` text DEFAULT '10m' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "native_flashcard_preferences_retention" CHECK(typeof("native_flashcard_preferences"."desired_retention") = 'integer' AND "native_flashcard_preferences"."desired_retention" BETWEEN 70 AND 97),
	CONSTRAINT "native_flashcard_preferences_new_preset" CHECK("native_flashcard_preferences"."new_card_preset" IN ('10m', '1m+10m', '30m')),
	CONSTRAINT "native_flashcard_preferences_relearning_preset" CHECK("native_flashcard_preferences"."relearning_preset" IN ('10m', '30m', '1h'))
);
--> statement-breakpoint
ALTER TABLE `native_flashcard_notes` ADD COLUMN `tags_json` text DEFAULT '[]' NOT NULL CONSTRAINT "native_flashcard_notes_tags_json" CHECK (json_valid(`tags_json`) AND json_type(`tags_json`) = 'array');
