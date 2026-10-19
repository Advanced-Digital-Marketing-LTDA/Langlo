CREATE TRIGGER `native_flashcard_notes_source_shape_insert`
BEFORE INSERT ON `native_flashcard_notes`
WHEN NOT (
  (NEW.`source_attempt_id` IS NULL AND NEW.`source_skill_id` IS NULL AND NEW.`source_content_version_id` IS NULL)
  OR (NEW.`source_attempt_id` IS NOT NULL AND NEW.`source_skill_id` IS NOT NULL AND NEW.`source_content_version_id` IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'native flashcard note source fields must be all null or all set');
END;--> statement-breakpoint
CREATE TRIGGER `native_flashcard_notes_source_shape_update`
BEFORE UPDATE OF `source_attempt_id`, `source_skill_id`, `source_content_version_id` ON `native_flashcard_notes`
WHEN NOT (
  (NEW.`source_attempt_id` IS NULL AND NEW.`source_skill_id` IS NULL AND NEW.`source_content_version_id` IS NULL)
  OR (NEW.`source_attempt_id` IS NOT NULL AND NEW.`source_skill_id` IS NOT NULL AND NEW.`source_content_version_id` IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'native flashcard note source fields must be all null or all set');
END;
