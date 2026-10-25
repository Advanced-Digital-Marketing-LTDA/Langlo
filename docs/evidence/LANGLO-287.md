# LANGLO-287: prompt injection guard in front of OpenAI

Local implementation evidence captured on 2026-10-25.

## Behavior

- `src/lib/server/openai-guard.ts` holds the only code that sends a request to
  OpenAI (`guardedOpenAiResponse`). The guard runs inside it, so a new call
  site cannot skip it.
- The guard checks every untrusted field (previous, current and next sentence,
  and the selected term) in two steps:
  1. A local check for instruction-override phrases in English, French,
     German and Portuguese, and for hidden control, zero-width and
     bidirectional characters.
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
- The Decisions API is not used.

## Local checks

- `npx vitest run tests/openai-guard.test.ts tests/library-ai.test.ts tests/library-routes.test.ts`: 69 tests passed. The full suite was not run locally.
- `npm run check`: 0 errors, 0 warnings.
- `npx eslint` on the changed files and `npx prettier --check src tests`: clean.
