# Content impact preview status accuracy

Date: 2026-10-25. Base: `main` at `8d491c0`. This follow-up fixes two accuracy errors in the read-only `content:import --impact` preview introduced with LANGLO-167. No tracker changes were made; the existing LANGLO-167 and LANGLO-214 Done dispositions are preserved. No production import, database, provider call, migration, or deployment was used.

## Behavior

- `src/lib/server/content-impact.ts` still counts answers that stop counting per version line. It now compares each learner's current grammar status with the package's final status once per affected skill, using the same `currentContent`, `qualifyingGrammarEvidence`, and `scoreGrammar` functions as mastery.
- The projected current version is the newest version that will remain non-quarantined after the package. The preview requalifies the full stored answer history against that content and applies package quarantine states to those rows, so quarantining a version can restore eligible answers from its fallback version.
- When several version lines affect one skill, the cumulative status change is printed once under the last affected version line. Retirement answer counts, carry/replacement handling, and the absence of status changes on retirement lines are unchanged.
- `tests/content-update.test.ts` uses disposable fixture databases. The fallback and successive-version cases compare preview output with actual mastery qualification before and after a synthetic import, and also assert the preview itself leaves fixture state unchanged.
- `docs/content-update.md` documents the final-package comparison.

## Observed red before the fix

Command:

```text
npx vitest run tests/content-update.test.ts -t 'requalifies full answer history|reports the cumulative status change' --reporter=verbose
```

Observed: `Test Files 1 failed (1)`, `Tests 2 failed | 48 skipped (50)`. Before quarantine, the fallback case had `practising` status; the preview returned `practising → unknown` where it should have requalified the old incorrect answer and returned `practising → weak`. The two-version case expected a cumulative `practising → unknown` transition but the preview returned an empty `statusChanges` list.

## Observed green after the fix

```text
npx vitest run tests/content-update.test.ts -t 'requalifies full answer history|reports the cumulative status change' --reporter=verbose
Test Files 1 passed (1)
Tests 2 passed | 48 skipped (50)
```

The separate tally/order test passed with `1 passed | 50 skipped` and verifies three synthetic learners, including aggregation of two learners with the same transition and sorting two distinct transitions. The final `content-update` and importer-script regression run passed: `Test Files 2 passed (2)`, `Tests 76 passed (76)`. The full suite passed: `Test Files 127 passed (127)`, `Tests 2098 passed (2098)`.

In the green fallback run, the test then applied quarantine only to its disposable database and confirmed actual mastery became `weak`. In the green cumulative run, importing the full package made actual mastery `unknown`. Both tests assert the read-only preview did not mutate fixture state where applicable.

Internal adversarial review: GPT-6.1 Sol, Medium effort, read-only; approved with no material findings. The reviewer examined the implementation, mastery/import semantics, tests, and documentation. It inspected tests but did not rerun them; validation results below are from this task's commands.

## Final repository validation

- `npm ci --ignore-scripts --cache /workspace/.npm-cache` — passed.
- `npm run check` — passed; Svelte check found 0 errors and 0 warnings.
- `npm run lint` — passed.
- `npm run format:check` — passed; all matched files use Prettier style.
- `npm test` — passed; 127 files and 2,098 tests.
- `npm run test:property` — passed; 6 files and 9 tests.
- `npm run build` — passed.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e` — passed; 190 tests, 2 projects, 0 failed. The pinned Playwright browser was absent and the CDN download was blocked, so this run used the system Chromium already present in the environment; no system packages were installed.

## Scope preserved

- No `mastery.ts` rules, curriculum, schema, or migration changed.
- No production import or database was touched.
- No tracker was updated.
- PR #186's OpenAI guard paths remain unchanged.

## Published-head review and local follow-up

The initial draft was opened as [PR #188](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/188) on `fix/content-import-impact-preview-accuracy`, based on `main` at `8d491c0`. With parent approval, commit `3fa123ce0081010a11a10a53bf5a448769f7ba0a` was pushed and the PR description was updated to list all four changed files and final local validation. `git ls-remote` and the PR both confirmed that exact head at the time. The review notes below describe that head, `3fa123c`.

All exact-head GitHub workflow jobs completed successfully: Quality (including unit, property, build, E2E, evidence-integrity, and TestTrust steps), Dependency review, Ratchets, OSSAR, ESLint, Adversarial review, rewardguard, merge-evidence-gate, Codecov, and APKG feasibility. The merge-evidence-gate passed. Its refreshed comment still says `docs/content-update.md` and `src/lib/server/content-impact.ts` are absent from the PR body, although both paths are listed in the current body; it also marks property/E2E claims unverifiable from its repository test report.

On `3fa123c`, CodeScene's new review cleared the earlier complexity and nesting findings, then reported an advisory excessive-argument finding for `packageSkillStatusChanges` (6 arguments), `statusChangesByOwner` (5), and `ownerStatusChange` (5), with a maximum of 4. Commit `e321cf3` groups their shared inputs into `PackageStatusContext` and `StatusProjectionContext`; it is pushed, and `main` was later merged into the branch as `8db2c54`. GPT-6.1 Sol Medium reviewed the grouping read-only and approved it with no material findings. CodeScene has not rechecked it in this document's record.

Codacy's refreshed GitHub comment reports 0 new issues and complexity 43 within its limit, but duplication remains 2 against a threshold of 1. Its dashboard detail page returned a network tunnel 403, so the duplicated lines are unknown and no code change was made for that metric. SonarCloud reports a passed quality gate and 2 new issues (down from 4 on the previous head); the issue details page also returned a network tunnel 403, so those issues remain unknown. Codecov reports 90% patch coverage with 2 missing and 5 partially covered lines in `src/lib/server/content-impact.ts`; its GitHub comment does not identify the lines.

The local argument-grouping change passed the focused importer regression (76 tests), the full unit suite (127 files, 2,098 tests), property tests (9), type check (0 errors/warnings), lint, format, build, and browser E2E (190 passed, 0 failed). It remains a local change pending parent approval before any additional push. No tracker update was made; LANGLO-167 and LANGLO-214 remain in their previously recorded Done state pending the parent's coordination.

## Same-package carry follow-up

Review of `8db2c54` found that the projected "after" state ignored a retirement's `carry` into a skill that the same package also versions, so the reported status for that replacement skill could be too low. The preview now adds the package's approved carries (`carry: true` with `replacedBy`) to the projected content before re-qualifying answers. The new test "counts answers carried into a skill by a retirement in the same package" passes with the change and fails with `"to": "unknown"` when the change is reverted. Limit: status lines attach only to existing version lines, so a carry into a skill that has no version line in the package, including a brand-new replacement skill, is not projected. Validation of this follow-up ran locally on the touched test file only; CI on the new head is the full-suite signal.
