-- A new content version never resets grammar retention: every schedule moves to the skill's newest published version with its recall state and due date unchanged.
-- Schedules that earlier migrations' triggers reset get their due date back from the recall state they still store; a reset row whose stored state has no readable due date stops the migration.
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM grammar_retention_schedules WHERE reset_required = 1 AND NOT (json_type(state_json, '$.due') = 'text' AND json_extract(state_json, '$.due') GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z' AND strftime('%s', json_extract(state_json, '$.due')) IS NOT NULL)) THEN 1 ELSE abs(-9223372036854775808) END;
--> statement-breakpoint
DROP TRIGGER `grammar_retention_reset_new_content`;
--> statement-breakpoint
DROP TRIGGER `grammar_retention_reset_published_content`;
--> statement-breakpoint
DROP TRIGGER `grammar_retention_follow_wording_content`;
--> statement-breakpoint
DROP TRIGGER `grammar_retention_follow_wording_published_content`;
--> statement-breakpoint
ALTER TABLE `content_versions` DROP COLUMN `retention_reset`;
--> statement-breakpoint
CREATE TRIGGER `grammar_retention_transfer_new_content` AFTER INSERT ON `content_versions` WHEN `NEW`.`status` IN ('schema-validated', 'pilot-ready') AND NOT EXISTS (SELECT 1 FROM content_versions v WHERE v.skill_id = NEW.skill_id AND v.language = NEW.language AND v.status IN ('schema-validated', 'pilot-ready') AND v.version > NEW.version) BEGIN UPDATE `grammar_retention_schedules` SET `content_version_id` = `NEW`.`id`, `revision` = `revision` + 1 WHERE `skill_id` = `NEW`.`skill_id` AND `language` = `NEW`.`language` AND `content_version_id` <> `NEW`.`id`; END;
--> statement-breakpoint
CREATE TRIGGER `grammar_retention_transfer_published_content` AFTER UPDATE OF `status` ON `content_versions` WHEN `OLD`.`status` NOT IN ('schema-validated', 'pilot-ready') AND `NEW`.`status` IN ('schema-validated', 'pilot-ready') AND NOT EXISTS (SELECT 1 FROM content_versions v WHERE v.skill_id = NEW.skill_id AND v.language = NEW.language AND v.status IN ('schema-validated', 'pilot-ready') AND v.version > NEW.version) BEGIN UPDATE `grammar_retention_schedules` SET `content_version_id` = `NEW`.`id`, `revision` = `revision` + 1 WHERE `skill_id` = `NEW`.`skill_id` AND `language` = `NEW`.`language` AND `content_version_id` <> `NEW`.`id`; END;
--> statement-breakpoint
UPDATE `grammar_retention_schedules` SET `due_at` = CAST(strftime('%s', json_extract(`state_json`, '$.due')) AS INTEGER) * 1000 + CAST(substr(json_extract(`state_json`, '$.due'), 21, 3) AS INTEGER), `reset_required` = 0, `revision` = `revision` + 1 WHERE `reset_required` = 1;
