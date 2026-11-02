# Impact report: learner status changes (LANGLO-167)

Date: 2026-10-25. Base: `main` `f0e8d3d`. Closes the gap listed under "Pending acceptance" in `content-update-20261019.md`: `content:import --impact` counted answers but not status. Owner approved the change list in the project thread. No production or remote database, provider call or deployment was used; every database in the tests is a disposable local fixture. No migration was added or edited.

## Behavior

- `contentImpact` (`src/lib/server/content-impact.ts`): for each line where answers would stop counting, each affected learner's grammar status is scored before (all answers mastery counts for the skill) and after (minus the stopping answers) with `scoreGrammar`, the same function mastery uses. The line gains `statusChanges`: `{ from, to, learners }`, only for learners whose status differs. Answer and learner counts are unchanged.
- Retirement lines carry no `statusChanges`: a retired skill leaves the catalog. The report does not simulate the status a replacement gains from a carry.
- `scripts/content-import.ts`: `--impact` prints `impact: SKILL: N learner(s) would change from X to Y` under each line.
- `docs/content-update.md` step 5 says so.

## Observed green

Node 24.19.0 / npm 11.9.0, only the touched test files:

```text
vitest run tests/content-update.test.ts tests/content-import-script.test.ts
Test Files 2 passed (2)   Tests 72 passed (72)
```

`svelte-check` 0 errors; eslint and prettier clean on the changed files.

New tests: weak to practising when a wrong answer's question is removed; weak to practising when quarantine drops the answers given in a version; no change listed when the status stays the same (the existing first impact test now expects `statusChanges: []`); a retirement line has no `statusChanges`; the script prints each status line. The fixture evaluator marks a mismatching typed answer `uncertain`, so the tests set the evaluation outcome to `incorrect` directly.

## Observed red (a guard removed, matching test fails, guard restored)

- status after taken as status before: 2 failed in `content-update`
- retirement line keeps `statusChanges`: 1 failed
- status lines not printed by the script: 1 failed

## Not run

Full suite, `test:property`, `test:e2e`, `build`: left to CI. Not run against a real Turso database.
