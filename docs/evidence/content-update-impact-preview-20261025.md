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

The initial draft was opened as [PR #188](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/188) on `fix/content-import-impact-preview-accuracy`, based on `main` at `8d491c0`. The published head is `18e06d49a9dd09b3f0a18d92b277ebda648bc068`; `git ls-remote` confirmed the remote branch still points to that commit. PR #188 is open, draft, and unmerged.

All exact-head GitHub workflows completed successfully, including Quality, Dependency review, Ratchets, OSSAR, ESLint, Adversarial review, rewardguard, merge-evidence-gate, Codecov, and APKG feasibility. The merge-evidence-gate passed but noted that `docs/content-update.md` and `src/lib/server/content-impact.ts` were not named in the PR description. The description has not been updated pending parent approval for post-publication changes.

CodeScene reported `packageStatusChanges` complexity 11 (threshold 9), `currentKeysAfterPackage` complexity 9 (threshold 9), two nested logic blocks in `packageStatusChanges`, and module mean complexity 4.12 across 17 functions (threshold 4). A local-only refactor splits version candidate selection and per-skill/per-owner status projection into helpers and centralizes quarantine status selection. The GPT-6.1 Sol Medium adversarial follow-up review approved it with no material findings. The final local behavior assertions, full unit suite, property tests, type/lint/format checks, build, and browser E2E all passed after this refactor. CodeScene has not reviewed a new head; the local refactor remains unpublished while awaiting parent approval for another push.

Codacy's PR comment reported one medium complexity issue and duplication metric 2 (threshold 1), without identifying the duplicated lines. Its dashboard was inaccessible from this environment, so the duplication finding could not be verified. The local refactor addresses the reported complexity through helper extraction and consolidates the repeated quarantine-state selection, but Codacy has not rechecked it. SonarCloud's PR comment reported a passed quality gate and four new issues; the issue details page was also inaccessible from this environment.

The PR remains a draft pending review. No tracker update was made; LANGLO-167 and LANGLO-214 remain in their previously recorded Done state pending the parent's coordination.
