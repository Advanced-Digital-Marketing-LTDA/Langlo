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

- `npm run check`, `npm run lint`, `npm run format:check`, `npm run build`,
  `npm run validate:curriculum`, and `npm run content:import` (dry run): pass.
- A focused assert-based check confirms the loader passes all 45 translations
  into the import package and that English lessons, questions, references, and
  IDs are unchanged.
- Test suites were not run. Hosted checks are pending.
- `npm ci --ignore-scripts` completed with the pinned toolchain; npm reported
  two moderate dependency advisories. No dependency files were changed.
