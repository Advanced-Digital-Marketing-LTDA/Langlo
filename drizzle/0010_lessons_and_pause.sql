CREATE TABLE `lessons` (
	`content_version_id` text PRIMARY KEY NOT NULL,
	`skill_id` text NOT NULL,
	`language` text NOT NULL,
	`title` text NOT NULL,
	`explanation` text NOT NULL,
	`examples` text NOT NULL,
	`refs` text NOT NULL,
	`fingerprint` text NOT NULL,
	FOREIGN KEY (`content_version_id`,`skill_id`,`language`) REFERENCES `content_versions`(`id`,`skill_id`,`language`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "lessons_fingerprint" CHECK(length("lessons"."fingerprint") = 64 AND "lessons"."fingerprint" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "lessons_title" CHECK(length(trim("lessons"."title")) > 0)
);
--> statement-breakpoint
ALTER TABLE `study_sessions` ADD `paused_at` integer;