CREATE TABLE `lesson_translations` (
	`content_version_id` text NOT NULL,
	`explanation_language` text NOT NULL,
	`title` text NOT NULL,
	`explanation` text NOT NULL,
	`examples` text NOT NULL,
	`refs` text NOT NULL,
	`fingerprint` text NOT NULL,
	PRIMARY KEY(`content_version_id`, `explanation_language`),
	FOREIGN KEY (`content_version_id`) REFERENCES `lessons`(`content_version_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "lesson_translations_language" CHECK("lesson_translations"."explanation_language" IN ('pt')),
	CONSTRAINT "lesson_translations_fingerprint" CHECK(length("lesson_translations"."fingerprint") = 64 AND "lesson_translations"."fingerprint" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "lesson_translations_title" CHECK(length(trim("lesson_translations"."title")) > 0)
);
