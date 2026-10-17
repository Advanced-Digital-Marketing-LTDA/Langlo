# LANGLO-44–47 integrated evidence

Date: 2026-10-17. Branch: `codex/langlo-9-grammar-mastery`, baseline `91a9e61`.
The owner explicitly authorized work on LANGLO-44–47 and a push after finishing.
Plans were written before each task in `docs/plans/T017.md` through `T020.md`.
Task-specific observed red/green details are in `T017.md` through `T020.md` in
this evidence directory. The earlier LANGLO-9 preparation is historical.

## Delivered behavior

- T017 / LANGLO-44: saved, owner-scoped holdout assessments, A1-gap sampling,
  hidden feedback until transactional completion, explicit Not sure, immediate
  reload-safe practice feedback and server-classified assisted retries.
- T018 / LANGLO-45: versioned `grammar-1` policy, deduplicated qualifying grammar
  evidence and deterministic recommendations. FSRS/recall do not enter mastery.
- T019 / LANGLO-46: dashboard, semantic keyboard/mobile skill map and detailed
  progress, including prerequisites, evidence reasons and manual topic access.
- T020 / LANGLO-47: bounded exact-item/version reports, owner-only history,
  idempotency/daily cap and documented code-based versioned correction workflow.

Migrations `0013_assessment_feedback` and `0014_content_reports` are additive.
Only marked disposable synthetic local fixtures were migrated. Existing rows,
evaluation rubrics and triggers are preserved by upgrade tests. No content,
authentication/provider configuration, scheduler, dependency pins, prototype
screens or CI policy was changed.

## Validation

Runtime: Node `v24.19.0`, npm `11.9.0`. The pinned npm CLI was installed under
`/tmp/langlo-9-toolchain` and the npm cache stayed under `/tmp`.

| Command                                        | Observed integrated result                                 |
| ---------------------------------------------- | ---------------------------------------------------------- |
| `npm ci --ignore-scripts --no-audit --no-fund` | Passed, 480 packages; lockfile unchanged.                  |
| `npm run check`                                | Passed, 0 errors/0 warnings.                               |
| `npm run lint`                                 | Passed.                                                    |
| `npm run format:check`                         | Passed.                                                    |
| `npm test`                                     | Passed, 57 files / 1045 tests.                             |
| `npm run test:property`                        | Passed, 5 files / 7 tests, default 100 cases per property. |
| `npm run build`                                | Passed, Node adapter.                                      |
| `npm run test:e2e`                             | Passed, 74 desktop/mobile tests.                           |

The rendered grammar journey uses real forms for practice, assisted retry,
assessment start/answers/Not sure, reload, results and reports. It verifies
premature results HTTP 409, hidden evaluation API responses, keyboard manual
navigation, progress, escaped report text and preserved exact item/version.
No real provider request is part of these checks; fake adapters and synthetic
principals are separate from live acceptance.

Dependency installation emitted existing esbuild-kit deprecation notices; the
environment emits a NO_COLOR/FORCE_COLOR notice during build/browser runs.
Audit was not run and no dependency versions were changed to suppress warnings.

## Adversarial review and disposition

Applied the installed `adversarial-review:adversarial-review` skill with two
Optimizer and two Skeptic passes using session-native agents. Review artifacts
and raw mechanical logs remain in `/tmp/langlo-44-47-review` and
`/tmp/langlo-44-47-validation` / `/tmp/langlo-44-47-final`. This is not a
cross-provider review or a live CI review.

The post-review regression checkpoint passed 24 service tests in three files and
the complete rendered grammar journey on both desktop and mobile (2 tests,
13.4s). It submits the answered-item report while the next question is displayed,
checks the stored target, triggers both validation messages and verifies unique
IDs, and checks an overlong report's visible error. The mastery regression also
performs an actual synthetic FSRS approval/review and verifies unchanged grammar
evidence. Final repeated mechanical output is under `/tmp/langlo-44-47-prepush`.

No confirmed Major/Critical findings were reported; both Skeptic passes approved
subject to regression validation. All three confirmed Minor findings were fixed:

| Finding                                                                           | Fix and verification                                                                                                                                          |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFC normalization could expand a bounded comment beyond the database constraint.  | Validate the normalized length too. U+0344 regression observed SQLITE_CONSTRAINT before the fix, then INVALID_REPORT after it.                                |
| Practice feedback could report the next item or lesson but not the answered item. | Add a dedicated feedback report using saved question/version and its own key. Browser submits it while the next question is current and checks stored target. |
| Retry and next-question forms reused an error element ID.                         | Derive validation IDs from question ID. Browser triggers both errors and asserts two distinct IDs.                                                            |

An additional negative browser check found an overlong lesson report had no
visible error outside an exercise. It observed a missing alert before the fix;
the report action now renders its own bounded, accessible validation message.

## Publication and acceptance boundaries

The branch push is authorized; publication is reported separately after verifying
the exact remote SHA. No PR, tracker Done transition, CI workflow dispatch,
deployment or production database operation is authorized or performed here.
Hosted checks for the pushed head, live provider behavior, Windows Anki and release
acceptance remain unverified. Mastery thresholds are local heuristics, not a
calibrated CEFR certification.
