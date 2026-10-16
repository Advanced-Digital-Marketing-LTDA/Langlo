# Content-version immutability follow-up

Date: 2026-10-16. Branch: `codex/open-pr-review-20261016`.

The owner approved this server/storage follow-up and publication of the repair
branch as a pull request. It closes the content-revision issue found in the
[individual PR-comment audit](open-pr-review-triage.md#additional-findings-confirmed-from-summary-only-comments).

## Failure and repair

Previously, importing an existing content version checked its identity, question
IDs and formats, but not prompts, answers or alternatives. A newer curriculum
version could therefore claim different question content under the same content
and question IDs. The original curriculum version's package fingerprint blocked
this only when the curriculum version itself stayed unchanged.

The importer now stores a SHA-256 fingerprint of each new content version's
question payload. Each question contributes its ID, format, prompt, answer and
optional alternatives in a fixed key order. Questions are sorted by ID before
hashing; question order and source object-key order do not change identity.
Alternative order and exact text remain part of identity. Review status is
excluded so the existing one-way quarantine behavior continues to work.

An existing content version must match this fingerprint as well as the existing
metadata and stored question checks. A mismatch raises `CONTENT_CONFLICT` inside
the existing transaction; earlier skill, prerequisite, version and question
inserts and the curriculum ledger are rolled back together. Revised content
still requires a new content version and new question IDs.

## Migration and legacy behavior

`0007_content_payload_fingerprint.sql` adds one nullable text column to
`content_versions`. The generated snapshot differs from snapshot 0006 only in
this column and snapshot ancestry. No old migration is edited; no table is
rebuilt and no existing content, learner data, index or trigger is rewritten.

Legacy rows keep a null fingerprint because their original payload was never
stored. The importer rejects these versions, including an otherwise identical
reimport or quarantine request, rather than trusting an incoming package as a
backfill. Existing study reads are unchanged. An importer caller must use a new
content version and new question IDs for legacy content; no automatic recovery
or production backfill is implemented.

Only disposable local SQLite fixtures were migrated. The migration upgrade test
starts from migrations 0000–0006 with synthetic study data, applies 0007, and
checks unchanged version metadata, learner attempts, indexes and triggers, null
legacy fingerprints, foreign keys and SQLite integrity. Remote migration tests
continue to use file-backed stand-ins, not a remote database.

## Observed red and green

- Before implementation, the three prompt/answer/alternatives regressions failed
  because the importer returned a successful import rather than
  `ContentImportError`. The migration test failed because the fingerprint column
  did not exist and the ledger still contained seven migrations.
- After adding only the column, all five then-written importer regressions still
  failed as behavior assertions: changed payloads and null legacy fingerprints
  were accepted. This separated the missing importer guard from a schema error.
- After implementing the guard, the focused importer/migration/remote-test suite
  passed **107 tests across three files**. The remote-test CLI's old seven-entry
  expectation was updated to the eight-entry migration inventory.
- A temporary mutation disabled only the fingerprint comparison. All eight
  selected payload-change and legacy regressions failed. The comparison was
  restored before subsequent validation.

Logs are retained locally under `/tmp/langlo-content-identity-*.log` and
`/tmp/langlo-content-migration-red.log`; generated databases and build output are
excluded from Git.

## Full local validation

Using Node **24.19.0** and npm **11.9.0**:

- `npm ci --ignore-scripts`: 280 packages installed, zero audit vulnerabilities.
- `npm run check`: zero errors and zero warnings.
- `npm run lint` and `npm run format:check`: passed.
- `npm test`: **794 tests across 40 files**, no skips.
- `npm run test:property`: **5 properties across 4 files**.
- `npm run validate:curriculum`: **125 records, 164 edges**, approved 1.0.0.
- `npm run build`: passed.
- `npm run test:e2e`: **72 browser tests**, desktop and mobile, against the
  built Node server and disposable synthetic fixtures.
- `drizzle-kit check`: passed. Snapshot comparison confirmed only the added
  fingerprint column; the generated SQL is a single `ALTER TABLE ... ADD`.
- `git diff --check`: passed.

Full check logs are `/tmp/langlo-content-final-*.log`; the step exit codes and
timings are `/tmp/langlo-content-validation-results.json`.

## Publication and integration

The original three repair commits were pushed at `c1ad20a` at the owner's
request. PR [#80](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/80)
was then observed already open for this branch; the follow-up updates that PR.
No duplicate PR or readiness change is needed.

The upstream curriculum PRs were integrated using different commit histories.
At `origin/main` commit `9806057`, the common curriculum files match their
original stack versions, while this branch retains the reviewed repairs.
Some later curriculum modules remain present only on the repair branch.
The `main` synchronization preserves these modules and the repairs, rather than
restoring original content through add/add conflict markers. Its resolution is
checked for exact tree equality with the already-validated repair tree; the
merge changes ancestry only. This does not merge PR #80 into `main`.

## Acceptance and remaining limits

This fingerprint is an import identity guard, not storage of deliverable question
payloads. LANGLO-125 holdout separation and runtime payload persistence remain
release blockers. No learner schema, auth, grading, UI, curriculum JSON, provider
configuration or deployment is changed by this follow-up.

The requested external local review layers are not claimed as executed. The
PR Review Toolkit specialist agents, gstack commands and Warp validator were not
available as callable tools or local installs in this session. The local
adversarial reviewer would call a provider using the owner's CLI/key and has not
been authorized separately. Foreground source and test review does not replace
those independent reviews. Hosted checks and release acceptance remain separate
from local validation.
