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

Pending acceptance: new draft PR review and exact-head CI. The tracker remains as previously marked Done pending the parent's coordination.
