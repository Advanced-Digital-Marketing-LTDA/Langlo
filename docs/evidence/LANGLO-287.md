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
  The guard is not counted against the grading monthly cap. Each request
  that reaches OpenAI counts once against the daily Library AI budget.
- Each guard block or failure logs one structured line with an operation, a
  reason code (`pattern`, `jev-flagged`, `http-401`, `timeout`, `network`,
  `malformed`, `invalid-config`, `openai-key-missing`, `typesafe-key-missing`) and, for pattern blocks, the field name. It
  never logs learner text or keys.
- A request the guard blocks or cannot check never reaches OpenAI, so its
  daily Library AI slot is given back (`releaseLibraryAiCall`). A failed OpenAI
  attempt keeps its slot, as before. Route tests pin both for a local pattern
  block, a Jev flag and a Jev outage.
- The Decisions API is not used.

## Test method

The tests were written together with the implementation, not first, so no
test-first history exists for this change. To show the tests detect a missing
guard, the guard call in `guardedOpenAiResponse` was temporarily bypassed and
the three focused test files were run: 21 of 82 tests failed (red). With the
guard restored, all 82 passed (green). The bypass was not committed.

## Pending acceptance

- The Jev guard question and the OpenAI call were only exercised against
  stubbed providers. They are unverified against the live TypeSafe and OpenAI
  services.
- `npm test` (full suite), `npm run test:property`, `npm run build` and
  `npm run test:e2e` were not run locally: the project owner's rule is that the
  full suite is never run in the cloud environment because it is far too slow.
  CI runs them on this branch.
- `TYPESAFE_API_KEY` is now required for Library translation and lookup, and
  learner text is sent to Jev.

## Local checks

- `npx vitest run tests/openai-guard.test.ts tests/library-ai.test.ts tests/library-routes.test.ts tests/library-ai-usage.test.ts`: 91 tests passed (adds `tests/library-ai-usage.test.ts`). The full suite was not run locally.
- `npm run check`: 0 errors, 0 warnings.
- `npx eslint` on the changed files and `npx prettier --check src tests`: clean.

The quota refund tests were also run red: with the release call disabled, the
three new route tests failed (3 of 24), and they pass with it restored.
