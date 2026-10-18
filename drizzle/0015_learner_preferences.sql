CREATE TABLE `learner_preferences` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`timezone` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "learner_preferences_timezone" CHECK(length(trim("learner_preferences"."timezone")) BETWEEN 1 AND 64 AND instr("learner_preferences"."timezone", char(0)) = 0)
);
