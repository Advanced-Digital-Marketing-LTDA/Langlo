CREATE TABLE `library_document_files` (
	`document_id` text PRIMARY KEY NOT NULL,
	`format` text NOT NULL,
	`data` blob NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `library_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "library_document_files_format" CHECK("library_document_files"."format" IN ('pdf', 'docx', 'epub')),
	CONSTRAINT "library_document_files_size" CHECK(length("library_document_files"."data") BETWEEN 1 AND 10000000)
);
--> statement-breakpoint
ALTER TABLE `library_documents` ADD `progress_location` text;