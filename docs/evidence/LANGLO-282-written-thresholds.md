# LANGLO-282: written-answer probability thresholds

Date: 2026-10-26. Local implementation; live acceptance remains pending.

## Behavior and scope

Written answers that reach the existing Jev fallback use the raw probability:

- Below 0.60: wrong (`incorrect`).
- From 0.60 inclusive to 0.80 exclusive: unsure (`uncertain`).
- At least 0.80: correct.

No rounding is applied. The unsure band records `low-confidence` rather than
`tie`. Invalid probabilities, malformed responses, provider failures, timeouts,
and quota exhaustion retain their existing uncertain behavior. The provider
request, rubric, prepared matching, multiple choice, and UI are unchanged.

Evaluator `jev-2` distinguishes the new thresholds from historical `jev-1`.
The rubric remains `jev-rubric-1` because its text and question are unchanged.
The settled marker is `jev-2-no-verdict`. Old Jev rows stay stored and visible
in assessment/practice feedback and mistake-card eligibility when their rubric
matches the content version. They do not qualify as current mastery evidence;
recomputed mastery may therefore decrease until new qualifying answers arrive.
No historical rows are rewritten and no schema migration is needed.

## Observed red and green

Tests were written before production edits. All HTTP responses and learners
were synthetic, with disposable local fixture databases only.

- Parser/attempt red: 2 files failed, 20 failures and 44 passes. The old parser
  treated 0.60–0.79 as correct and 0.50 as unsure; persistence still used `jev-1`.
- Historical feedback red: 2 files failed, 2 failures and 97 passes. A `jev-2`
  verdict did not supersede prepared feedback for summaries or mistake cards.
- Focused green: 4 files passed, 163 tests passed. Coverage includes below/at/above
  0.60 and 0.80, unrounded 0.799999, persisted outcomes, no mastery contribution
  from unsure answers, versioned evaluations, and retained historical feedback.

## Validation

Using Node 24.19.0 and npm 11.9.0 (the pinned npm CLI was invoked directly
because the shell's `npm` is a distrobox wrapper):

- `npm ci --ignore-scripts`: passed; lockfile unchanged.
- `npm run check`: passed, zero errors and warnings.
- `npm run lint`: passed.
- `npm run format:check`: failed solely on ignored local
  `.claude/settings.local.json`; it was left untouched. A separate Prettier check
  of all tracked regular files plus this new evidence file passed.
- `npm test`: passed, 128 files and 2,171 tests, including properties.
- `npm run test:property`: passed, 6 files and 9 tests.
- `npm run build`: passed.
- `npm run test:e2e`: passed, 190 desktop/mobile tests, zero failures, flaky
  tests, or skips. The completed run followed the unit suite and a fresh build.

The first sandboxed full-unit attempt was interrupted after child-process/Git
fixture failures. The full unit run above passed outside the sandbox. The
first browser attempt failed before collection with `listen EPERM` on localhost;
the browser run uses the built Node server outside the sandbox. No assertions
or checks were weakened to bypass the environment restrictions.

An overlapping unit/browser run was interrupted after mobile hydration failures.
`tests/sentry-vite-config.test.ts` invokes `vite build` during the unit suite,
replacing assets under the already-running browser server. Traces showed
`ERR_EMPTY_RESPONSE` for old hashed JS files, and those paths no longer existed
in `build/client`. After the unit suite completed, build and browser validation
were restarted sequentially without code or assertion changes.

## Pending acceptance

No real TypeSafe/OpenAI calls, credentials, production data, Windows Anki,
deployment, or live calibration were used or verified. Local validation does
not establish CI or release success. Tracker status/dates/priority are unchanged.
