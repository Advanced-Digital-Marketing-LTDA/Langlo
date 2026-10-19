# Portuguese explanations for English A1/A2

Date: 2026-10-19. The follow-up is based on PR #109's head because that PR is
still open. Its parent adds the immutable translation table and reader.

## Scope

Added Brazilian Portuguese titles, explanations, and example translations for
all 45 English A1/A2 lessons. Each example keeps its English sentence and adds
the Portuguese equivalent. The English lesson text, questions, German modules,
French modules, references, catalog, prerequisites, and IDs are unchanged.

The translations are stored as `version.translations.pt` in the authored
English module files. `content-modules.ts` passes those translations into the
existing content importer. The curriculum manifest is now `1.1.0`, a minor bump
for additive translated lesson content.

## Review and limits

The owner authorized writing the Portuguese text in this task. The translations
were checked against their English source by the author. No independent
Brazilian Portuguese specialist review has taken place. The modules retain the
repository's existing approved status under its recorded model-authored
curriculum policy; this evidence does not claim specialist approval.

The branch is stacked on PR #109. No database was connected, no content was
imported, and no production state was changed.

## Local validation

- Behavior tests were run before the fix with:
  `npm test -- tests/content-import-script.test.ts -t 'passes every authored Portuguese translation|rejects a misspelled translation field|rejects a translation block placed at lesson level|rejects an unsupported explanation language|refuses a partly migrated database'`.
  The 4 new behavior cases failed: the “When is the class?” example had the
  wrong Portuguese meaning, and three malformed translation shapes were
  silently accepted until package loading failed for an unrelated missing
  bundle. The partial-migration assertion passed.
- The same focused command passed after the fixes: 5 passed, 15 skipped.
  It checks all 45 Portuguese translations reach the import package, the
  source lessons and questions remain unchanged across all modules, malformed
  or misplaced translation keys are rejected, the corrected example is
  present, and the partial-migration message names the latest journal tag.
- `npm test`: 78 files and 1,270 tests passed.
- `npm run test:property`: 5 files and 7 tests passed.
- `npm run test:e2e`: 90 passed, 0 failed, 0 flaky, 0 skipped.
- `npm run check`, `npm run lint`, `npm run format:check`,
  `npm run validate:curriculum`, `npm run content:import` (dry run),
  `npm run build`, and `git diff --check`: passed. The import dry run reported
  package 1.1.0 with 124 skills, 124 lessons, and 1,860 questions; nothing was
  written.
- No production database was connected and no content was imported. Hosted
  checks for the updated head are pending.
- `npm ci --ignore-scripts` completed with the pinned toolchain; npm reported
  two moderate dependency advisories. No dependency files were changed.
