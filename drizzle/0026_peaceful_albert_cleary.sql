CREATE TABLE `grammar_retention_events` (
	`id` text NOT NULL,
	`owner_id` text NOT NULL,
	`study_session_id` text NOT NULL,
	`language` text NOT NULL,
	`skill_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`evaluation_id` text NOT NULL,
	`content_version_id` text NOT NULL,
	`lineage_key` text NOT NULL,
	`expected_revision` integer NOT NULL,
	`rating` text NOT NULL,
	`reviewed_at` integer NOT NULL,
	`scheduler_version` text NOT NULL,
	`parameters_json` text NOT NULL,
	`result_json` text NOT NULL,
	`state_json` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`language`,`skill_id`) REFERENCES `grammar_retention_schedules`(`owner_id`,`language`,`skill_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`study_session_id`,`owner_id`,`language`) REFERENCES `study_sessions`(`id`,`owner_id`,`language`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`,`owner_id`,`skill_id`,`language`) REFERENCES `attempts`(`id`,`owner_id`,`skill_id`,`language`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`evaluation_id`,`owner_id`,`attempt_id`) REFERENCES `evaluations`(`id`,`owner_id`,`attempt_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_version_id`,`skill_id`,`language`) REFERENCES `content_versions`(`id`,`skill_id`,`language`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "grammar_retention_events_rating" CHECK("grammar_retention_events"."rating" IN ('again', 'hard', 'good', 'easy')),
	CONSTRAINT "grammar_retention_events_revision" CHECK(typeof("grammar_retention_events"."expected_revision") = 'integer' AND "grammar_retention_events"."expected_revision" >= 0),
	CONSTRAINT "grammar_retention_events_reviewed_at" CHECK(typeof("grammar_retention_events"."reviewed_at") = 'integer' AND "grammar_retention_events"."reviewed_at" >= 0),
	CONSTRAINT "grammar_retention_events_json" CHECK(json_valid("grammar_retention_events"."parameters_json") AND json_valid("grammar_retention_events"."result_json") AND json_valid("grammar_retention_events"."state_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `grammar_retention_events_session_skill` ON `grammar_retention_events` (`owner_id`,`study_session_id`,`skill_id`);--> statement-breakpoint
CREATE INDEX `grammar_retention_events_skill_time` ON `grammar_retention_events` (`owner_id`,`language`,`skill_id`,`reviewed_at`);--> statement-breakpoint
CREATE TABLE `grammar_retention_schedules` (
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
	CONSTRAINT "grammar_retention_schedules_language" CHECK("grammar_retention_schedules"."language" IN ('fr', 'de', 'en')),
	CONSTRAINT "grammar_retention_schedules_due" CHECK(typeof("grammar_retention_schedules"."due_at") = 'integer' AND "grammar_retention_schedules"."due_at" >= 0),
	CONSTRAINT "grammar_retention_schedules_revision" CHECK(typeof("grammar_retention_schedules"."revision") = 'integer' AND "grammar_retention_schedules"."revision" >= 0),
	CONSTRAINT "grammar_retention_schedules_reset" CHECK(typeof("grammar_retention_schedules"."reset_required") = 'integer' AND "grammar_retention_schedules"."reset_required" IN (0, 1)),
	CONSTRAINT "grammar_retention_schedules_state" CHECK(json_valid("grammar_retention_schedules"."state_json")),
	CONSTRAINT "grammar_retention_schedules_parameters" CHECK(json_valid("grammar_retention_schedules"."parameters_json"))
);
--> statement-breakpoint
CREATE INDEX `grammar_retention_schedules_owner_due` ON `grammar_retention_schedules` (`owner_id`,`language`,`due_at`);--> statement-breakpoint
ALTER TABLE `attempts` ADD `grammar_rating` text CHECK(`grammar_rating` IS NULL OR `grammar_rating` IN ('again', 'hard', 'good', 'easy'));--> statement-breakpoint
ALTER TABLE `study_sessions` ADD `grammar_retention_policy_version` text;
--> statement-breakpoint
CREATE TRIGGER `grammar_retention_events_no_update` BEFORE UPDATE ON `grammar_retention_events` BEGIN SELECT RAISE(ABORT, 'grammar retention history cannot be updated'); END;
--> statement-breakpoint
CREATE TRIGGER `grammar_retention_events_no_delete` BEFORE DELETE ON `grammar_retention_events` WHEN EXISTS (SELECT 1 FROM `grammar_retention_schedules` WHERE `owner_id` = `OLD`.`owner_id` AND `language` = `OLD`.`language` AND `skill_id` = `OLD`.`skill_id`) BEGIN SELECT RAISE(ABORT, 'grammar retention history cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `grammar_retention_events_no_replace` BEFORE INSERT ON `grammar_retention_events` WHEN EXISTS (SELECT 1 FROM `grammar_retention_events` WHERE `owner_id` = `NEW`.`owner_id` AND `id` = `NEW`.`id`) BEGIN SELECT RAISE(ABORT, 'grammar retention history cannot be replaced'); END;
--> statement-breakpoint
CREATE TRIGGER `grammar_retention_reset_new_content` AFTER INSERT ON `content_versions` WHEN `NEW`.`status` IN ('schema-validated', 'pilot-ready') BEGIN UPDATE `grammar_retention_schedules` SET `content_version_id` = `NEW`.`id`, `due_at` = 0, `revision` = `revision` + 1, `reset_required` = 1 WHERE `skill_id` = `NEW`.`skill_id` AND `language` = `NEW`.`language` AND `content_version_id` <> `NEW`.`id`; END;
--> statement-breakpoint
CREATE TRIGGER `grammar_retention_reset_published_content` AFTER UPDATE OF `status` ON `content_versions` WHEN `OLD`.`status` NOT IN ('schema-validated', 'pilot-ready') AND `NEW`.`status` IN ('schema-validated', 'pilot-ready') BEGIN UPDATE `grammar_retention_schedules` SET `content_version_id` = `NEW`.`id`, `due_at` = 0, `revision` = `revision` + 1, `reset_required` = 1 WHERE `skill_id` = `NEW`.`skill_id` AND `language` = `NEW`.`language` AND `content_version_id` <> `NEW`.`id`; END;
