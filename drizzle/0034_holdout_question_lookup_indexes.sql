CREATE INDEX `attempts_owner_skill_idx` ON `attempts` (`owner_id`,`skill_id`);--> statement-breakpoint
CREATE INDEX `questions_language_holdout_idx` ON `questions` (`language`,`holdout`);