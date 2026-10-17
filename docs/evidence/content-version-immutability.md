# Content-version immutability and legacy adoption

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

Legacy rows initially keep a null fingerprint because their original payload was
never stored. Following the owner's approval of the compatibility repair, the
importer adopts them only when the incoming package's whole-package fingerprint
matches the existing `curriculum_imports` row for that same curriculum version.
Stored version metadata and question IDs/formats must also match. It writes only
the missing per-version fingerprints inside the import transaction. It neither
creates proof from the incoming package nor replaces a non-null fingerprint.

For an upgrade, first reimport the recorded original package, with its original
curriculum version and payload. Then import corrected content under new content
versions, new question IDs and a newer curriculum version. Repeating the adopted
original package is a no-op; one-way quarantine remains available afterwards.
If the original package or its matching ledger entry is unavailable, or the
incoming package differs, `LEGACY_CONTENT_UNVERIFIED` explains that the caller
must supply the recorded original package or publish new content and question
IDs. No unverifiable adoption, destructive repair or production backfill is run.

Only disposable local SQLite fixtures were migrated. The migration upgrade test
starts from migrations 0000–0006 with synthetic study data, applies 0007, and
checks unchanged version metadata, learner attempts, indexes and triggers, and
initially null legacy fingerprints. It then adopts the recorded package and
imports a corrected revision alongside the original, preserving learner attempts
and passing foreign-key and SQLite integrity checks. The legacy seed uses the
old SQL shape and a fixed historical package hash, without invoking the current
importer. Remote migration tests continue to use file-backed stand-ins, not a
remote database.

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

## Initial local validation, before the compatibility repair

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
release blockers. No learner schema, auth, grading, UI, provider configuration or
deployment is changed. Existing migrations and the schema definition are
unchanged by the compatibility repair; only the schema's legacy-field comment
is updated.

The requested external local review layers are not claimed as executed. The
PR Review Toolkit specialist agents and gstack commands were not
available as callable tools or local installs in this session. The local
adversarial reviewer would call a provider using the owner's CLI/key and has not
been authorized separately. Foreground source and test review does not replace
those independent reviews. Hosted checks and release acceptance remain separate
from local validation.

## Adversarial review findings and approved compatibility repair

The owner supplied the [CI review of head `e2678eb`](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/actions/runs/38951807264/job/117144762360). Its no-ship verdict identified
a valid upgrade limitation in the first, explicitly fail-closed implementation.
The owner then approved verified legacy adoption and new content identities.

1. **High: legacy null fingerprints block reimport.** Fixed through verified
   adoption against the saved package fingerprint. Computing a hash from stored
   question rows alone cannot verify a payload: those rows lack prompts, answers
   and alternatives. The migration-upgrade test now exercises the real pre-0007
   storage shape, migration, adoption and revised-content import in sequence.
2. **High: edited existing content retains its old identity.** Conservative fix:
   the 16 lessons below now use content version 2 and all 240 question IDs use the
   corresponding `@2` namespace. Payload wording is unchanged by this revision
   repair. Existing rows are retained; fixtures verify that every affected module
   imports alongside synthetic historical version/question IDs without overwrites.
3. **Medium: the same in-place content edits violate immutability.** Addressed by
   the same revision changes. An independent comparison against `origin/main`
   found no changed importer payload retaining an existing version ID. No claim
   is made about actual production imports, which were not inspected.

| Module              | Skills moved from version 1 to version 2 |
| ------------------- | ---------------------------------------- |
| German A1 module 01 | de-a1-001                                |
| German A1 module 04 | de-a1-010                                |
| German A1 module 06 | de-a1-021                                |
| German A2 module 01 | de-a2-002                                |
| German A2 module 02 | de-a2-005, de-a2-006, de-a2-007          |
| German A2 module 03 | de-a2-009, de-a2-010, de-a2-011          |
| French A1 module 02 | fr-a1-007                                |
| French A1 module 05 | fr-a1-017, fr-a1-019                     |
| French A1 module 06 | fr-a1-021, fr-a1-023, fr-a1-024          |

The earlier curriculum additions remain on the owner's requested repair branch;
they already have separate authoring commits. No additional PR split, branch
deletion or merge into `main` is performed for this repair.

Observed red: **8 failures across the importer and migration suites** before the
adoption change; the verified original package and actual pre-0007 upgrade both
raised `CONTENT_CONFLICT`, and the six unverifiable cases lacked their actionable
error. The curriculum suite had **26 failures** before the identity bumps,
including all nine historical-coexistence cases. Observed green afterwards:
**382 tests across these three files**.

The tests also cover missing ledger proof, changed prompts/answers/alternatives,
changed curriculum versions, partial packages, rollback of an earlier adoption
when later stored metadata differs, repeated no-op imports, quarantine, and
retaining original version/question records. The old null-rejection tests were
replaced with these verified-adoption and fail-closed cases.

Follow-up logs: `/tmp/langlo-legacy-adoption-{red,green}.log`,
`/tmp/langlo-revision-identities-red.log`, and
`/tmp/langlo-content-revision-bumps.json`.

Full compatibility-follow-up validation on Node 24.19.0 / npm 11.9.0:

- `npm ci --ignore-scripts`: 280 packages, zero audit vulnerabilities.
- `npm run check`: zero errors and zero warnings.
- `npm run lint` and `npm run format:check`: passed.
- `npm test`: **811 tests across 40 files**, no skips.
- `npm run test:property`: **5 properties across 4 files**.
- `npm run validate:curriculum`: **125 records, 164 edges**, approved 1.0.0.
- `npm run build`: passed.
- `npm run test:e2e`: **72 desktop/mobile browser tests**, built Node server,
  disposable synthetic fixtures.
- `drizzle-kit check` and `git diff --check`: passed. No migration file changed.

Logs are `/tmp/langlo-legacy-final-*.log`; step exit codes and timings are in
`/tmp/langlo-legacy-validation-results.json`. These are local results, not a claim
that the earlier failed CI review has passed on the new head. Provider-backed
reviews were not invoked manually; publication triggers the configured checks.
