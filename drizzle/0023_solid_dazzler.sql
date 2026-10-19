CREATE TEMP TABLE `langlo_10_review_history_gate` (
	`valid` integer NOT NULL CHECK (`valid` = 1)
);
--> statement-breakpoint
INSERT INTO `langlo_10_review_history_gate` (`valid`)
SELECT CASE WHEN EXISTS (
	SELECT 1
	FROM `native_flashcard_notes` AS `note`
	JOIN `native_flashcards` AS `card`
		ON `card`.`note_id` = `note`.`id` AND `card`.`owner_id` = `note`.`owner_id`
	JOIN `native_flashcard_review_events` AS `event`
		ON `event`.`card_id` = `card`.`id` AND `event`.`owner_id` = `card`.`owner_id`
	WHERE `note`.`status` = 'draft'
) THEN 0 ELSE 1 END;
--> statement-breakpoint
DROP TABLE `langlo_10_review_history_gate`;
--> statement-breakpoint
ALTER TABLE `native_flashcard_review_events`
	ADD COLUMN `state_json` text CONSTRAINT `native_flashcard_review_events_state_json`
	CHECK (`state_json` IS NULL OR json_valid(`state_json`));
--> statement-breakpoint
DELETE FROM `native_flashcards`
WHERE EXISTS (
	SELECT 1 FROM `native_flashcard_notes` AS `note`
	WHERE `note`.`id` = `native_flashcards`.`note_id`
		AND `note`.`owner_id` = `native_flashcards`.`owner_id`
		AND `note`.`status` IN ('draft', 'rejected')
)
AND NOT EXISTS (
	SELECT 1 FROM `native_flashcard_review_events` AS `event`
	WHERE `event`.`card_id` = `native_flashcards`.`id`
		AND `event`.`owner_id` = `native_flashcards`.`owner_id`
);
