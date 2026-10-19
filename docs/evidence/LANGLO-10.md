# LANGLO-10 local implementation evidence

## Scope

Implement approval-gated editable Basic / bounded T003 Cloze mistake drafts,
stable note/card identity, UUID review idempotency, and append-only review events
that retain the resulting scheduler snapshot. No live provider, production
database, external account, paid request, or remote publication was used.

## Observed test-first failure

Focused behavior tests were added before the service changes. The first focused
run recorded these expected failures:

- a newly created draft already had one `native_flashcards` row (expected zero);
- review event reads did not contain the resulting scheduler state;
- `submitReview` accepted `not-a-uuid` and scheduled it.

## Migration repair and validation

The first focused migration regression reproduced
`SQLITE_ERROR: no such column: state_json`: the generated table rebuild selected
the new column from the pre-migration table. It also omitted the existing
`WITHOUT ROWID` option and append-only triggers. With owner approval scoped to
the new, unapplied 0023 migration and its metadata, the migration was repaired
to add nullable `state_json` in place. It now preserves the table layout and
triggers, fails closed if a draft has review history, deletes only unreviewed
draft/rejected scheduler rows, and retains reviewed rejected notes and their
events. Notes and legacy event rows remain; legacy snapshots read as `NULL`.

The migration regression verifies the added column, preserved note/event data,
`WITHOUT ROWID`, all three append-only triggers, a clean foreign-key check, and
the fail-closed case without card/event loss. After the repair, both new focused
migration cases passed.

## Local checks

- Runtime: Node `24.19.0`; npm `11.9.0` invoked through the pinned npm bootstrap.
- Dependencies: `npm ci --ignore-scripts` completed using the task-local npm
  cache.
- `npm run check`: pass, 0 errors and 0 warnings.
- `npm run lint`: pass.
- `npm run format:check`: pass.
- `npm test`: pass, 87 files and 1,366 tests.
- `npm run test:property`: pass, 5 files and 7 tests.
- `npm run build`: pass.
- `npm run test:e2e`: pass, 98 desktop/mobile browser tests against the built
  Node server with synthetic fixtures.
- `git diff --check`: pass.

## Outside this local verification

- Anki client import behavior, hosted CI, production login/storage, and release
  behavior remain outside this local evidence.
