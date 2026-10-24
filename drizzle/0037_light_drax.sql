CREATE TABLE `library_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`language` text NOT NULL,
	`content` text NOT NULL,
	`sentence_count` integer NOT NULL,
	`progress_index` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "library_documents_title" CHECK(length(trim("library_documents"."title")) BETWEEN 1 AND 160 AND length("library_documents"."title") <= 160 AND instr("library_documents"."title", char(0)) = 0),
	CONSTRAINT "library_documents_language" CHECK("library_documents"."language" IN ('fr', 'de', 'en', 'pt')),
	CONSTRAINT "library_documents_sentence_count" CHECK("library_documents"."sentence_count" > 0),
	CONSTRAINT "library_documents_progress" CHECK("library_documents"."progress_index" BETWEEN 0 AND "library_documents"."sentence_count")
);
--> statement-breakpoint
CREATE INDEX `library_documents_owner_created` ON `library_documents` (`owner_id`,`created_at`);