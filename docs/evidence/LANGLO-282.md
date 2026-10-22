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
is now `grammar-2` because its recognized fallback source changed. The existing
`feedbackEvaluation` selector accepts only the current evaluator and exact
content-version rubric, so historical `decisions-1` rows remain stored but do
not qualify as current Jev evidence. The new mastery regression covers this
filter. The previous separate injection-score question is removed because this
request asks only whether the answer is correct; state remains untrusted data,
and a request test ensures learner text stays out of question instructions.
Existing `decisions` usage counters remain historical data.
Forward migration `0033_typesafe_ai_usage` widens the usage API check and copies
existing rows while preserving their values.

## Test evidence

- RED: the initial focused regression run failed as expected against the old
  implementation: 7 files, 30 failing tests and 100 passing tests. Failures
  identified the old endpoint/payload/parser, configuration key, usage schema,
  and historical-evaluation policy mismatches.
- GREEN: focused fallback/configuration/history/migration run passed 10 files and
  212 tests. TypeSafe HTTP behavior used a fake `fetch`; migrations used
  disposable file-backed fixture databases.
- Review regression RED: the focused fallback run failed one test and passed 28
  when the usage-write catch omitted the error type. GREEN: the focused review
  suite passed 8 files and 190 tests after restoring `errorName` and tightening
  the malformed-response and configuration assertions.
- `npm run check`: passed with zero errors and warnings.
- `npm run lint` and `npm run format:check`: passed.
- `drizzle-kit check`: passed.
- `npm test`: passed, 105 files and 1,842 tests.
- `npm run test:property`: passed, 6 files and 9 tests.
- `npm run build`: passed.
- `npm run test:e2e`: passed, 142 desktop/mobile tests against the built Node
  server using synthetic fixtures. One earlier run had a single mobile timer
  assertion failure; the isolated case and a full rerun both passed without a
  code change.
- Dependencies were installed with pinned npm 11.9.0 and `--ignore-scripts`.

## Pending acceptance

No TypeSafe credentials or real provider calls were used. The endpoint, Jev
calibration and billing behavior have not been exercised against a live account.
No production database was accessed or migrated. The source branch was pushed;
no deployment or production publication occurred. Those checks remain pending.
