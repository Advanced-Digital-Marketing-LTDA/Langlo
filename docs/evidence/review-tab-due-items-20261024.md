# Review tab: due items by language

Date: 2026-10-24. Requested and approved by Andrew in the project thread.

## Behavior

The Review tab (`/app/review`) is now a navigation page. Language buttons at the
top, styled like the skill map's, choose a language (kept in `?language=`).
For that language it shows Flashcards and Grammar, each split into Overdue and
Due today with a count and its own button.

- Overdue: due before today's 04:00 study-day start in the learner's saved
  timezone (UTC when none is saved, as the scheduler already uses).
- Due today: due from that start until the next 04:00. A card reviewed today
  that comes due again later today counts again.
- No early review. A button only serves items due now. When today's items are
  all due later, the page shows "Next card/topic is due at HH:MM" instead of a
  button.
- Grammar buttons start the existing grammar review session with the oldest
  ready topics of that part of the day, at most five.
- The flashcard reviewer moved unchanged to `/app/review/flashcards`. It takes
  `language` and `due=overdue|today` from the Review tab's buttons and has a
  "Back to review" link. Its rating form and the Review tab's grammar form post
  to URLs that keep `language` (and `due`), because SvelteKit 3 reloads the
  page at the form's action URL after a submission.
- A card's language is its deck's language. For decks made before decks had a
  language, it is the card's source content language. Cards with neither
  appear under an "Unassigned" option, shown when such cards are due and kept
  while it is the chosen option, so "Back to review" from its emptied queue
  still opens the tab.
- Creating a deck requires choosing one of the learner's enrolled languages.
  New mistake decks get their language.

## Data

Forward migration `0036_deck_language` adds a nullable `language` column to
`native_flashcard_decks`. Existing decks keep `NULL`; there is no backfill. No
earlier migration, snapshot or journal entry changed.

## Other changes needed by the feature

- `startGrammarReview` now accepts any due topic of the track, not only the
  five oldest, so "Due today" can start while more than five topics are
  overdue. The five-topic session limit is unchanged, and the Practice page
  still offers the five oldest.
- `tests/db-migrations.test.ts` and `tests/portuguese-migration.test.ts` list
  `0036_deck_language` as the newest pending migration in their expected
  pending-tag arrays. This is the forward migration this PR adds; every other
  expected tag and count is unchanged, and both tests still fail if the file is
  missing or misnamed.
- Tests that do not depend on a deck's language create French decks through
  the `tests/fixtures/french-deck.ts` helper. Two legacy migration fixtures
  insert their deck with SQL, because the old schema has no language.

## Checks run

- Red: `tests/review-due.test.ts` and `tests/review-render.test.ts` were run
  against base `origin/main` (8d3d06c). All 9 failed: `no such column:
language`, `listDecks` returned no `language`, and the reviewer and Review
  tab pages did not exist at their new paths.
- Green (this branch): `tests/review-due.test.ts`, `tests/review-render.test.ts`,
  the new cases in `tests/grammar-retention.integration.test.ts`,
  `tests/mistake-cards.test.ts` and `tests/learner-journeys.test.ts`, plus every
  unit test file edited for the deck language (`db-migrations`,
  `native-flashcards`, `native-flashcards-content`, `auth`,
  `learner-owner-scope`, `learner-owner-scope.pbt`, `learner-routes`,
  `mistake-card-routes`).
- `tests/e2e/review-ratings.spec.ts` (desktop and mobile) failed in CI after
  rating the first card: the page reloaded without `language`/`due` and showed
  "Page unavailable". Reproduced locally, then passed after the form actions
  kept the query.
- Codecov patch coverage was 78.5% (target 87.37%). Added learner-journey
  tests for the "next card/topic is due at" times, the tab without
  enrollments, an unknown reviewer language, and starting overdue grammar from
  the Review tab; both Review route files now have every line covered.
- Codex review: returning to `?language=unassigned` after its last card was
  reviewed gave 404. The new learner-journey assertion failed with 404 before
  the fix and passes after it.
- `svelte-check`, ESLint and Prettier pass on changed files.
- Not run here: the full suite and the e2e specs (`review-ratings`,
  `fsrs-settings-decks`, `owner-routes`), which CI runs.
