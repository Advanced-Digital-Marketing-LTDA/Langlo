# LANGLO-287: prompt injection guard in front of OpenAI

Local implementation evidence captured on 2026-10-25.

## Behavior

- `src/lib/server/openai-guard.ts` holds the only code that sends a request to
  OpenAI (`guardedOpenAiResponse`). The guard runs inside it, so a call site
  cannot skip the check. Each caller must list every learner-supplied field in
  `untrusted`; the guard does not scan the request body.
- The guard checks every untrusted field (previous, current and next sentence,
  and the selected term) in two steps:
  1. A local check for instruction-override phrases in English, French,
     German and Portuguese, and for hidden control, zero-width and
     bidirectional characters. The phrases need a scope word such as
     "previous", "all" or "your", so ordinary study text like "Ignore the
     rules of grammar." passes; negative tests pin this.
  2. A TypeSafe Jev `noul` question asking whether the text contains
     instructions for an AI model. A probability of 0.5 or more blocks.
- A match returns `LIBRARY_AI_BLOCKED` (422) with a clear message. If the
  TypeSafe key is missing, or Jev times out, errors or returns a malformed
  answer, the request fails with `LIBRARY_AI_UNAVAILABLE`. OpenAI is not
  called in any of these cases. There is no fallback provider, model or
  skipped check.
- `TYPESAFE_API_KEY` is now also required for Library translation and lookup.
  The guard is not counted against the grading monthly cap. Each guarded
  request still counts once against the daily Library AI budget.
- Each guard block or failure logs one structured line with an operation, a
  reason code (`pattern`, `jev-flagged`, `http-401`, `timeout`, `network`,
  `malformed`, `invalid-config`, `openai-key-missing`, `typesafe-key-missing`) and, for pattern blocks, the field name. It
  never logs learner text or keys.
- Blocked or guard-failed requests still count against the daily Library AI
  budget, as failed OpenAI attempts already do.
- The Decisions API is not used.

## Test method

The tests were written together with the implementation, not first, so no red
run was observed for this change. They assert behavior through the public
functions and the study route with stubbed providers.

## Pending acceptance

- The Jev guard question and the OpenAI call were only exercised against
  stubbed providers. They are unverified against the live TypeSafe and OpenAI
  services.
- `npm test` (full suite), `npm run test:property`, `npm run build` and
  `npm run test:e2e` were not run locally; CI runs them.
- `TYPESAFE_API_KEY` is now required for Library translation and lookup, and
  learner text is sent to Jev.

## Local checks

- `npx vitest run tests/openai-guard.test.ts tests/library-ai.test.ts tests/library-routes.test.ts`: 82 tests passed. The full suite was not run locally.
- `npm run check`: 0 errors, 0 warnings.
- `npx eslint` on the changed files and `npx prettier --check src tests`: clean.
