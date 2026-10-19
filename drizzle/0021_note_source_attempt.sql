CREATE TRIGGER `native_flashcard_notes_source_attempt_insert`
BEFORE INSERT ON `native_flashcard_notes`
WHEN NEW.`source_attempt_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `attempts` a
  WHERE a.`id` = NEW.`source_attempt_id`
    AND a.`owner_id` = NEW.`owner_id`
    AND a.`skill_id` = NEW.`source_skill_id`
    AND a.`content_version_id` = NEW.`source_content_version_id`
)
BEGIN
  SELECT RAISE(ABORT, 'native flashcard note source must match the owner attempt');
END;--> statement-breakpoint
CREATE TRIGGER `native_flashcard_notes_source_attempt_update`
BEFORE UPDATE OF `owner_id`, `deck_id`, `source_attempt_id`, `source_skill_id`, `source_content_version_id` ON `native_flashcard_notes`
WHEN NEW.`source_attempt_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `attempts` a
  WHERE a.`id` = NEW.`source_attempt_id`
    AND a.`owner_id` = NEW.`owner_id`
    AND a.`skill_id` = NEW.`source_skill_id`
    AND a.`content_version_id` = NEW.`source_content_version_id`
)
BEGIN
  SELECT RAISE(ABORT, 'native flashcard note source must match the owner attempt');
END;
