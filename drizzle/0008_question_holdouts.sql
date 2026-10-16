ALTER TABLE `questions` ADD `holdout` integer DEFAULT false NOT NULL CONSTRAINT `questions_holdout` CHECK (`holdout` IN (0, 1));
