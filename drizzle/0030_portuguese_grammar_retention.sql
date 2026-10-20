-- Add Portuguese grammar schedules without changing stored schedules or review history.
-- The runner must disable foreign-key enforcement before its transaction; changing it inside a transaction is ineffective.
-- Recreate the three guards that reference the rebuilt table, and fail the batch on lost rows or dangling references.
CREATE TEMP TABLE langlo_grammar_compat_foreign_keys (must_be_off integer NOT NULL CHECK(must_be_off = 0));
--> statement-breakpoint
INSERT INTO langlo_grammar_compat_foreign_keys SELECT foreign_keys FROM pragma_foreign_keys;
--> statement-breakpoint
DROP TABLE langlo_grammar_compat_foreign_keys;
--> statement-breakpoint
CREATE TEMP TABLE langlo_grammar_compat_counts (kind text PRIMARY KEY, total integer NOT NULL);
--> statement-breakpoint
INSERT INTO langlo_grammar_compat_counts SELECT 'schedules', count(*) FROM grammar_retention_schedules;
--> statement-breakpoint
INSERT INTO langlo_grammar_compat_counts SELECT 'events', count(*) FROM grammar_retention_events;
--> statement-breakpoint
DROP TRIGGER grammar_retention_events_no_delete;
--> statement-breakpoint
DROP TRIGGER grammar_retention_reset_new_content;
--> statement-breakpoint
DROP TRIGGER grammar_retention_reset_published_content;
--> statement-breakpoint
CREATE TABLE `__new_grammar_retention_schedules` (
	`owner_id` text NOT NULL,
	`language` text NOT NULL,
	`skill_id` text NOT NULL,
	`content_version_id` text NOT NULL,
	`state_json` text NOT NULL,
	`due_at` integer NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`reset_required` integer DEFAULT false NOT NULL,
	`scheduler_version` text NOT NULL,
	`parameters_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`owner_id`, `language`, `skill_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`,`language`) REFERENCES `skills`(`id`,`language`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`content_version_id`,`skill_id`,`language`) REFERENCES `content_versions`(`id`,`skill_id`,`language`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "grammar_retention_schedules_language" CHECK("__new_grammar_retention_schedules"."language" IN ('fr', 'de', 'en', 'pt')),
	CONSTRAINT "grammar_retention_schedules_due" CHECK(typeof("__new_grammar_retention_schedules"."due_at") = 'integer' AND "__new_grammar_retention_schedules"."due_at" >= 0),
	CONSTRAINT "grammar_retention_schedules_revision" CHECK(typeof("__new_grammar_retention_schedules"."revision") = 'integer' AND "__new_grammar_retention_schedules"."revision" >= 0),
	CONSTRAINT "grammar_retention_schedules_reset" CHECK(typeof("__new_grammar_retention_schedules"."reset_required") = 'integer' AND "__new_grammar_retention_schedules"."reset_required" IN (0, 1)),
	CONSTRAINT "grammar_retention_schedules_state" CHECK(json_valid("__new_grammar_retention_schedules"."state_json")),
	CONSTRAINT "grammar_retention_schedules_parameters" CHECK(json_valid("__new_grammar_retention_schedules"."parameters_json"))
);
--> statement-breakpoint
INSERT INTO `__new_grammar_retention_schedules`("owner_id", "language", "skill_id", "content_version_id", "state_json", "due_at", "revision", "reset_required", "scheduler_version", "parameters_json", "created_at") SELECT "owner_id", "language", "skill_id", "content_version_id", "state_json", "due_at", "revision", "reset_required", "scheduler_version", "parameters_json", "created_at" FROM `grammar_retention_schedules`;
--> statement-breakpoint
DROP TABLE `grammar_retention_schedules`;
--> statement-breakpoint
ALTER TABLE `__new_grammar_retention_schedules` RENAME TO `grammar_retention_schedules`;
--> statement-breakpoint
CREATE INDEX `grammar_retention_schedules_owner_due` ON `grammar_retention_schedules` (`owner_id`,`language`,`due_at`);
--> statement-breakpoint
CREATE TRIGGER `grammar_retention_events_no_delete` BEFORE DELETE ON `grammar_retention_events` WHEN EXISTS (SELECT 1 FROM `grammar_retention_schedules` WHERE `owner_id` = `OLD`.`owner_id` AND `language` = `OLD`.`language` AND `skill_id` = `OLD`.`skill_id`) BEGIN SELECT RAISE(ABORT, 'grammar retention history cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `grammar_retention_reset_new_content` AFTER INSERT ON `content_versions` WHEN `NEW`.`status` IN ('schema-validated', 'pilot-ready') AND NOT EXISTS (SELECT 1 FROM content_versions v WHERE v.skill_id = NEW.skill_id AND v.language = NEW.language AND v.status IN ('schema-validated', 'pilot-ready') AND v.version > NEW.version) BEGIN UPDATE `grammar_retention_schedules` SET `content_version_id` = `NEW`.`id`, `due_at` = 0, `revision` = `revision` + 1, `reset_required` = 1 WHERE `skill_id` = `NEW`.`skill_id` AND `language` = `NEW`.`language` AND `content_version_id` <> `NEW`.`id`; END;
--> statement-breakpoint
CREATE TRIGGER `grammar_retention_reset_published_content` AFTER UPDATE OF `status` ON `content_versions` WHEN `OLD`.`status` NOT IN ('schema-validated', 'pilot-ready') AND `NEW`.`status` IN ('schema-validated', 'pilot-ready') AND NOT EXISTS (SELECT 1 FROM content_versions v WHERE v.skill_id = NEW.skill_id AND v.language = NEW.language AND v.status IN ('schema-validated', 'pilot-ready') AND v.version > NEW.version) BEGIN UPDATE `grammar_retention_schedules` SET `content_version_id` = `NEW`.`id`, `due_at` = 0, `revision` = `revision` + 1, `reset_required` = 1 WHERE `skill_id` = `NEW`.`skill_id` AND `language` = `NEW`.`language` AND `content_version_id` <> `NEW`.`id`; END;
--> statement-breakpoint
SELECT CASE WHEN (SELECT count(*) FROM grammar_retention_schedules) = (SELECT total FROM langlo_grammar_compat_counts WHERE kind = 'schedules') AND (SELECT count(*) FROM grammar_retention_events) = (SELECT total FROM langlo_grammar_compat_counts WHERE kind = 'events') THEN 1 ELSE abs(-9223372036854775808) END;
--> statement-breakpoint
SELECT CASE WHEN EXISTS (SELECT 1 FROM pragma_foreign_key_check) THEN abs(-9223372036854775808) ELSE 1 END;
--> statement-breakpoint
DROP TABLE langlo_grammar_compat_counts;
