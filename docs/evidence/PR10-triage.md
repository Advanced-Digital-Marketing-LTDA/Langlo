# PR #10 triage and review fixes — 2026-10-11

Branch: `codex/langlo-test-integrity-20261011` (PR #10, draft), head `ef6dc88` before this round.

## Scope

Review findings were adjudicated and the valid ones fixed in the validator
scripts and their tests. Per maintainer instruction, `.github/workflows/ci.yml`
was intentionally left unchanged in this round; the base-ref hardening
(findings below) remains scheduled for a follow-up.

## Findings adjudicated

- Amazon Q `pendingTestCount` double-count — invalid. Vitest 5.0.3
  (`packages/vitest/src/node/reporters/json.ts`) computes `numPendingTests`
  from `run|queued|skip` assertion states, matching the validator's
  `skipped + pending + disabled` (`disabled` is never emitted; harmless).
- CodeAnt "`pending` suite status rejected" — invalid. Vitest emits only
  `'failed' | 'passed'` as `testResults[].status` (json.ts lines 49, 203).
- Codacy "Generic Object Injection Sink" — false positive on the severity
  counter read; the key is restricted to the constant `SEVERITIES` set before
  any use. The counters now use `Map`, removing the pattern entirely.
- Merge-Evidence Gate `C4: .github/workflows/ci.yml edited` — expected
  fail-closed behavior on this PR; the gate exists to require human review of
  workflow edits. It will keep this PR's `foundation` job red by design until
  a maintainer resolves it.
- Gitar force-push unreachable `before` SHA and CodeAnt `HEAD^` first-push
  fallback — valid; the `cat-file -e` guard + merge-base fallback is deferred
  with the rest of `ci.yml` by instruction.
- CodeAnt suite-counters gap — valid; `numTotalTestSuites` counts nested
  describes (`getSuites` recurses, and each file task is `type: 'suite'`),
  so the check is inequality-based: total ≥ file count, failed/passed suite
  counters ≥ corresponding file counts, plus the existing non-negative sum.
- CodeAnt all-failed report rejection — partially valid; the hollow-evidence
  guard now requires ≥1 executed assertion (passed or failed), matching the
  documented contract that test failures remain valid evidence.
- SonarCloud S8707 (argv path → `readFileSync`) — fixed by
  `scripts/report-path.mjs`, which canonicalizes the target and requires it
  under the working directory, `os.tmpdir()`, or `RUNNER_TEMP`/`TMPDIR`.
- SonarCloud S8689 (error message → log) — filesystem details are wrapped in
  fixed messages before reaching the CLI error path.
- Codacy/SonarCloud complexity and style findings — fixed by splitting both
  validators into focused functions, `Set` lookups, `TypeError` for type
  checks, removing the nested ternary, and `node:` imports for `process` and
  `console` (same pattern as `curriculum-contract.mjs`).
- Test-suite findings — fixtures were deduplicated behind `findingWith` /
  `scoreWith` / `suiteWith` factories, non-null assertions removed, and the
  oversized rejection test split.

## Validation (local, Node 24.19.0)

Behavior tests were written first: 4 new/updated expectations failed against
the previous implementation (all-failed acceptance, `executed` wording, two
suite-counter cross-checks), then passed after the changes.

- `npm run check`: 0 errors, 0 warnings.
- `npm run lint`: passed.
- `npm run format:check`: passed after Prettier write.
- `npm test`: 220 passed across 22 files.
- `npm run test:property`: 3 passed.
- `npm run build`: passed.
- `npm run test:e2e`: 32 passed.

## Pending

- `ci.yml` base-ref guard + merge-base fallback (Gitar, CodeAnt first-push).
- SonarCloud/Codacy residual style findings and gate acceptance are verified
  only by the hosted runs after push; the Merge-Evidence Gate C4 flag on
  workflow edits stays red on this PR by design and requires maintainer
  resolution.
