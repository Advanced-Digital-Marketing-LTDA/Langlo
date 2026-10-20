-- Portuguese (Brazil) B1 and B2: widen the language and level checks of skills and enrollments.
-- SQLite cannot alter a CHECK, so both tables are rebuilt with every row kept; the gate below fails the migration if a row count changes.
-- The 0003 triggers on both tables are dropped with the tables and recreated here (the track guard now also allows pt B1/B2).
CREATE TEMP TABLE langlo_portuguese_counts (
  table_name text NOT NULL,
  row_count integer NOT NULL
);
--> statement-breakpoint
INSERT INTO langlo_portuguese_counts (table_name, row_count) SELECT 'enrollments', count(*) FROM enrollments;
--> statement-breakpoint
INSERT INTO langlo_portuguese_counts (table_name, row_count) SELECT 'skills', count(*) FROM skills;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_enrollments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`language` text NOT NULL,
	`starting_level` text NOT NULL,
	`explanation_language` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "enrollments_language" CHECK("__new_enrollments"."language" IN ('fr', 'de', 'en', 'pt')),
	CONSTRAINT "enrollments_level" CHECK("__new_enrollments"."starting_level" IN ('A1', 'A2', 'B1', 'B2')),
	CONSTRAINT "enrollments_explanation" CHECK("__new_enrollments"."explanation_language" IN ('en', 'pt'))
);
--> statement-breakpoint
INSERT INTO `__new_enrollments`("id", "owner_id", "language", "starting_level", "explanation_language", "created_at") SELECT "id", "owner_id", "language", "starting_level", "explanation_language", "created_at" FROM `enrollments`;--> statement-breakpoint
DROP TABLE `enrollments`;--> statement-breakpoint
ALTER TABLE `__new_enrollments` RENAME TO `enrollments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `enrollments_owner_language_unique` ON `enrollments` (`owner_id`,`language`);--> statement-breakpoint
CREATE UNIQUE INDEX `enrollments_identity_owner_language` ON `enrollments` (`id`,`owner_id`,`language`);--> statement-breakpoint
CREATE TABLE `__new_skills` (
	`id` text PRIMARY KEY NOT NULL,
	`language` text NOT NULL,
	`level` text NOT NULL,
	`retired_at` integer,
	`replaced_by` text,
	`carry_progress` integer,
	CONSTRAINT "skills_language" CHECK("__new_skills"."language" IN ('fr', 'de', 'en', 'pt')),
	CONSTRAINT "skills_level" CHECK("__new_skills"."level" IN ('A1', 'A2', 'B1', 'B2'))
);
--> statement-breakpoint
INSERT INTO `__new_skills`("id", "language", "level", "retired_at", "replaced_by", "carry_progress") SELECT "id", "language", "level", "retired_at", "replaced_by", "carry_progress" FROM `skills`;--> statement-breakpoint
DROP TABLE `skills`;--> statement-breakpoint
ALTER TABLE `__new_skills` RENAME TO `skills`;--> statement-breakpoint
CREATE UNIQUE INDEX `skills_identity_language` ON `skills` (`id`,`language`);--> statement-breakpoint
CREATE TRIGGER enrollments_supported_track_insert
BEFORE INSERT ON enrollments
WHEN NOT ((NEW.language = 'fr' AND NEW.starting_level = 'A1') OR (NEW.language IN ('de', 'en') AND NEW.starting_level IN ('A1', 'A2')) OR (NEW.language = 'pt' AND NEW.starting_level IN ('B1', 'B2')))
BEGIN
  SELECT RAISE(ABORT, 'Enrollment must use a supported track');
END;
--> statement-breakpoint
CREATE TRIGGER enrollments_supported_track_update
BEFORE UPDATE OF language, starting_level ON enrollments
WHEN NOT ((NEW.language = 'fr' AND NEW.starting_level = 'A1') OR (NEW.language IN ('de', 'en') AND NEW.starting_level IN ('A1', 'A2')) OR (NEW.language = 'pt' AND NEW.starting_level IN ('B1', 'B2')))
BEGIN
  SELECT RAISE(ABORT, 'Enrollment must use a supported track');
END;
--> statement-breakpoint
CREATE TRIGGER enrollments_portuguese_explanation_insert
BEFORE INSERT ON enrollments
WHEN NEW.language = 'pt' AND NEW.explanation_language = 'pt'
BEGIN
  SELECT RAISE(ABORT, 'Portuguese lessons are explained in English');
END;
--> statement-breakpoint
CREATE TRIGGER enrollments_portuguese_explanation_update
BEFORE UPDATE OF language, explanation_language ON enrollments
WHEN NEW.language = 'pt' AND NEW.explanation_language = 'pt'
BEGIN
  SELECT RAISE(ABORT, 'Portuguese lessons are explained in English');
END;
--> statement-breakpoint
CREATE TRIGGER skills_review_identity_insert
BEFORE INSERT ON skills
WHEN instr(NEW.id, char(0)) > 0
  OR length(trim(NEW.id, char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279))) = 0
BEGIN
  SELECT RAISE(ABORT, 'SourceID identity text must be nonblank and NUL-free');
END;
--> statement-breakpoint
CREATE TRIGGER skills_review_identity_update
BEFORE UPDATE OF id ON skills
WHEN instr(NEW.id, char(0)) > 0
  OR length(trim(NEW.id, char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279))) = 0
BEGIN
  SELECT RAISE(ABORT, 'SourceID identity text must be nonblank and NUL-free');
END;
--> statement-breakpoint
CREATE TEMP TABLE langlo_portuguese_gate (
  changed_tables integer NOT NULL CHECK(changed_tables = 0)
);
--> statement-breakpoint
INSERT INTO langlo_portuguese_gate (changed_tables)
SELECT count(*) FROM langlo_portuguese_counts
WHERE row_count <> CASE table_name
  WHEN 'enrollments' THEN (SELECT count(*) FROM enrollments)
  WHEN 'skills' THEN (SELECT count(*) FROM skills)
END;
--> statement-breakpoint
DROP TABLE langlo_portuguese_gate;
--> statement-breakpoint
DROP TABLE langlo_portuguese_counts;
