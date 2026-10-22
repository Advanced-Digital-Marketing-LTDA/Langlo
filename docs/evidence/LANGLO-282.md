# LANGLO-282: Jev answer-checking fallback

Date: 2026-10-22. Local implementation and verification only.

## Behavior

Unmatched typed answers use TypeSafe System One with `jev-latest` when
`TYPESAFE_API_KEY` is configured. Prepared matches, multiple-choice answers and
replayed submissions remain outside this fallback path. Each request contains
only the language, exercise format, prompt, accepted answers and learner answer
as structured state. A single `noul` question asks whether the learner's answer
fulfills the prompt's intended meaning in the target language. Accepted answers
are examples rather than an exhaustive list; equivalent grammatical answers are
allowed; required grammar/forms, spelling and accents are checked; capitalization
and punctuation are ignored unless the exercise tests them. All exercise state is
treated as untrusted content, never as instructions.

The endpoint and request/response contract were checked against TypeSafe's
[System One OpenAPI definition](https://api.typesafe.ai/openapi.json), which
defines `POST /v1/systemone`, bearer-key authorization, `jev-latest`, named Noul
answers as yes probabilities, and `usage.input_tokens`/`usage.output_tokens`.
Its example response uses 120 input and 12 output tokens. This documents the
contract shape; it does not establish live account access, calibration or billing.

A Noul value above `0.5` is correct, below `0.5` is incorrect, and exactly `0.5`
is uncertain. Malformed responses, provider failures, timeouts and a reached
monthly cap remain uncertain. The existing 100,000-call UTC-month cap and
10-second timeout are retained, as are content-free fallback logs.

The evaluator/rubric versions are `jev-1` and `jev-rubric-1`; the grammar policy
is now `grammar-2` because its recognized fallback source changed. The
`feedbackEvaluation` evidence selector accepts supported Jev or prepared
evaluations and excludes historical Decisions rows. User-facing assessment and
practice feedback recognizes a Decisions verdict only with its matching
historical rubric; practice summaries and mistake-card checks also rank that
saved verdict ahead of prepared uncertainty. These display and card-selection
paths do not change current mastery evidence. Regressions cover assessment,
practice and card feedback plus the mastery exclusion. The previous separate
injection-score question is removed because this request asks only whether the
answer is correct; state remains untrusted data, and a request test ensures
learner text stays out of question instructions. Existing `decisions` usage
counters remain historical data.
Forward migration `0033_typesafe_ai_usage` widens the usage API check and copies
existing rows while preserving their values.

## Test evidence

- The initial focused run against the old implementation reported 30 failures
  and 100 passes across 7 files. Failures identified the old endpoint, payload,
  parser, configuration key, usage schema, and historical-evaluation policy.
- The corrected fallback/configuration/history/migration run passed 212 tests
  across 10 files. TypeSafe HTTP behavior used a fake `fetch`; migrations used
  disposable file-backed fixture databases.
- The usage-write regression first reported 1 failure and 28 passes. After
  restoring `errorName`, the focused suite passed 192 tests across 8 files; it
  also covered malformed-response and configuration assertions, untrusted
  accepted answers, and usage recording for ties.
- Safe-log coverage: the focused fallback/adapter run passed 2 files and 40
  tests, including non-Error usage failures and a check that their details are
  not emitted.
- Before the historical-feedback fix, the focused Vitest run reported 2
  failures and 76 passes. Afterward, the practice-summary, mistake-card and
  mastery suites passed 108/108 with historical Decisions priority confined to
  feedback/card queries.
- Before the unreadable-body fix, the adapter and evaluator suites reported 2
  failures and 39 passes. Afterward, they passed 41/41; invalid JSON now raises
  a typed `malformed` provider error and remains uncertain without exposing body
  details.
- Before the assessment-feedback fix, its focused suite reported 1 failure and
  38 passes. After the change, the six assessment, provider, practice, card and
  mastery suites passed 189/189.
- `npm run check`: passed with zero errors and warnings.
- `npm run lint` and `npm run format:check`: passed.
- `drizzle-kit check`: passed.
- `npm test`: passed, 105 files and 1,849 tests.
- `npm run test:property`: passed, 6 files and 9 tests.
- `npm run build`: passed.
- `npm run test:e2e`: passed, 142 desktop/mobile tests against the built Node
  server using synthetic fixtures, with no failed, flaky or skipped tests.
- Dependencies were installed with pinned npm 11.9.0 and `--ignore-scripts`.

## Pending acceptance

No TypeSafe credentials or real provider calls were used. The endpoint, Jev
calibration and billing behavior have not been exercised against a live account.
No production database was accessed or migrated. The implementation and
historical-feedback fix are published on PR #154; hosted checks and review remain
separate acceptance gates. No deployment or production publication occurred.
