CREATE TABLE `curriculum_imports` (
	`curriculum_version` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "curriculum_imports_fingerprint" CHECK(length("curriculum_imports"."fingerprint") = 64 AND "curriculum_imports"."fingerprint" NOT GLOB '*[^0-9a-f]*')
);
