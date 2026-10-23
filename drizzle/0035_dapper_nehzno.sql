CREATE TABLE `study_time_segments` (
	`id` text NOT NULL,
	`owner_id` text NOT NULL,
	`category` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "study_time_segments_category" CHECK("study_time_segments"."category" IN ('flashcards', 'grammar')),
	CONSTRAINT "study_time_segments_span" CHECK("study_time_segments"."started_at" < "study_time_segments"."ended_at")
);
--> statement-breakpoint
CREATE INDEX `study_time_segments_owner_start` ON `study_time_segments` (`owner_id`,`started_at`);