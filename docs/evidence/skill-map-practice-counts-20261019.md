# Skill map loading and practice recommendations evidence

**Scope:** Initiative 79 implementation from the revised 2026-10-19 plan. This records local implementation and validation only; it does not establish streaming behavior through the deployed proxy or CDN.

## Changes

- The map now returns enrolled language and level rows promptly, then loads each language's catalog and mastery in sequence. Catalog titles and lesson links render before progress, with status placeholders; a failed stage logs the server error and renders a per-track alert. The dashboard and progress page still use their awaited loader.
- The map shows a language anchor for every enrollment. The multi-enrollment loader test already passed against the existing mastery path; this change adds visible anchors and coverage for each track.
- Mastery now reports practice answer totals and distinct practice sessions from the attempt rows already loaded. It counts practice-mode answers, including unsure or assisted answers, deduplicates evaluation joins, ignores assessment attempts and other owners, and carries retired-topic attempts to their replacement. Grammar evidence and scoring remain unchanged.
- The practice page shows up to five started, available weak or practising topics in the requested order, each with its status, count and lesson link, followed by all topics. The general Start practice action remains unchanged.
- No schema or migration changed. Shared-client serialization, evidence-ledger writes, scoring thresholds, assessment data, cards and prototype routes remain untouched.

## Red and green checks

- The streaming route test first failed because the old map response had no catalog promise. After the loader split and per-language queue, the route and pending-map render tests passed.
- The multi-enrollment loader test passed before the anchors were added, confirming `loadEnrolledMastery` already returned all enrolled tracks. The map render test then verified a navigation link and matching anchor for each language. No live development-app inspection was made.
- Before `recommendPractice` and the practice counts existed, the mastery tests reported the recommendation function missing and practice-count fields absent. Before the practice route loader was updated, its integration test received no recommendations. These tests passed after implementation.
- The three practice-page render tests first failed on the missing recommendation list, empty state and recoverable error state. They passed after rendering both status chips, counts, lesson links and error handling.
- A local fixture regression drops its `lessons` table to force catalog failure. It confirms the server logs that failure once even though dependent progress rejects too.
- Focused tests: 6 files, 57 tests passed (mastery, progress routes, map rendering, practice rendering and dashboard coverage).
- `npm run check`: 0 errors and 0 warnings.
- `npm run build`: passed.
- `npm run lint`: passed after a fixture-only unused-variable correction.
- `npm run format:check`: passed.

## Limits and pending acceptance

- The catalog-first map path reads the catalog and prerequisites once before mastery reloads them in its own snapshot. This adds those repeated reads per language to enable progressive rendering; the practice counts themselves add no query. No latency claim was measured.
- The full test suite was not run during the focused implementation work; CI runs it (the merge-evidence gate reports 1359 tests passing on head `10f83a0`). The PR description also lists local `npm test`, `npm run test:property` and `npm run test:e2e` runs; their output is not recorded in this file. No authenticated browser, live development app, remote database, Coolify proxy or Bunny CDN was accessed, so deployed streaming behavior and the reported development-app enrollment state remain unverified.
- No deployment or release acceptance was performed.
