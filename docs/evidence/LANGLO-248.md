# LANGLO-248 feasibility evidence

**Scope:** local, synthetic comparison for the proposed skill-level grammar FSRS schedule. No learner records, real provider calls, remote database or production settings were used.

## Setup

- Runtime: Node 24.19.0, npm 11.9.0.
- Scheduler: installed lockfile version `ts-fsrs@5.4.2`.
- Test: `tests/grammar-retention-feasibility.test.ts`.
- Synthetic clock begins at `2026-01-01T12:00:00.000Z`; scheduler fuzz is disabled for repeatability.
- Compared one sequence of six varying ratings against six schedules, each initialized for a newly seen question and rated once.

## Observed result

The first focused run passed both checks: `2 tests passed`. In the six-review skill sequence, the scheduler state reached `reps = 6`, `stability = 116.46002236`, and `due = 2026-05-27T12:00:00.000Z`. The six one-review question schedules each had `reps = 1`; their maximum stability was `8.2956`.

This shows that a skill-level schedule accumulates a much longer interval than separately scheduled unseen questions under the same rating history. The result is expected evidence of a granularity trade-off, not proof that either interval is appropriate for grammar skill retention. The synthetic test has no delayed response, unseen transfer outcome, population variation, content-specific difficulty, or uncertainty estimate.

## Decision and remaining acceptance

Owner-selected candidate: schedule by existing grammar skill, language and learner, and evaluate it against varying unseen questions. Keep the learner-facing retention warning qualitative and experimental. Do not infer CEFR, grammar mastery, or a calibrated correctness probability. Further calibration requires delayed recall and unseen equivalent questions across skills, tracks and experience levels, with leakage and uncertainty documented. No production exposure or rollout acceptance is established here.

## Validation record

- `npm exec --yes --ignore-scripts --package=npm@11.9.0 -- npm ci --ignore-scripts`: passed; 566 packages installed. npm reported two moderate dependency advisories, which were not changed as unrelated to this feasibility task.
- `npm exec --yes --ignore-scripts --package=npm@11.9.0 -- npm test -- tests/grammar-retention-feasibility.test.ts`: passed, 2 tests.
- `npm exec --yes --ignore-scripts --package=npm@11.9.0 -- npm run check`: passed; 0 errors and 0 warnings.
- Targeted Prettier check and ESLint on the new test: passed. `git diff --check`: passed.
- Full test suite, property suite, build and browser tests: not run in this documentation/feasibility phase; production source was not changed.
