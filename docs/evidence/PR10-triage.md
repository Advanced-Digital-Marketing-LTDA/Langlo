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

## Hosted-run follow-up — 2026-10-11

Push head `27b608c` (validator round + maintainer commits `41f8b7d` base-ref
hardening, `461e550` CODEOWNERS note, and a Prettier fix keeping the
`tests/*evidence*` glob literal inside a code span). Push-event `foundation`
passed fully; the pull-request run passed every step except the Merge-Evidence
Gate, which failed by design on `C4` for `ci.yml` and `AGENTS.md` edits. The
updated validators ran in CI: `Validated Vitest evidence: 220/220` and
`Validated TestTrust evidence: 3 files, 0 findings, pass (100/100)`. Overlock
reported one LOW finding (`TEST_AND_IMPL_TOGETHER` on the new report-path
test), below the `fail-on: high` threshold.

CodeAnt went green (0 antipatterns, 0 complex functions). SonarCloud narrowed
to a single S8707 on `readFileSync` inside `report-path.mjs`; the containment
helper is the mitigation, so the line carries a `// NOSONAR jssecurity:S8707`
justification. Codacy's remaining security findings are the three intrinsic fs
sinks in the path helper itself (`realpathSync` ×2, `readFileSync` ×1); a path
validator cannot resolve paths without them, so they need maintainer
acceptance in Codacy. `process.env[name]` computed access was replaced with
explicit variables, and helpers were reordered ahead of their callers to clear
the remaining warning-class findings.

## Pending

- `ci.yml` base-ref guard + merge-base fallback — landed via maintainer commit
  `41f8b7d`.
- Codacy fs-sink findings and SonarCloud/Codacy gate acceptance remain with
  the maintainer; the Merge-Evidence Gate C4 flags stay red on this PR by
  design and require maintainer resolution.
