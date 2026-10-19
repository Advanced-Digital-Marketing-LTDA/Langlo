# Open-tab app refresh evidence — 2026-10-19

## Behavior implemented

- SvelteKit checks for a new app version every 300,000 ms (five minutes).
- When a new version is detected, the shared layout navigates to the same URL with a GET once no exercise answer is in progress.
- An exercise blocks refresh while it has an answer, a submission in progress, or a failed submission. A failed answer stays visible; a successful save clears the block and allows the reload.
- Mounted exercises contribute separate refresh blocks; destroying a blocked exercise releases its block, while other dirty exercises continue to defer refresh.
- Refreshing the learner page retains the sign-in cookie and URL, and the saved attempt continues to pin the lesson's content version.

## Behavior evidence

- **Red, before the implementation:** the focused built-server browser test advanced the browser clock by five minutes and timed out waiting for `/_app/version.json`. The unchanged SvelteKit configuration still used its one-hour default poll interval.
- **Green, after the implementation:** the focused refresh scenario passed in desktop and mobile browser profiles. It checks the five-minute boundary, no refresh while the answer is dirty, answer retention and no refresh after a server refusal, and reload after a successful retry. It also verifies the saved attempt, pinned version, and authenticated session after reload.
- **Recovery form refresh:** a built-server browser test submits the native `/recover` form, detects a synthetic update, and verifies the refresh is a GET with exactly one captured reset email. The pre-change Chromium run also used GET and sent one email, so no behavior-level red was reproduced in that browser; this change makes the safe request method explicit.
- **Refresh-block regression coverage:** the new lifecycle test navigates away from a dirty exercise and observes the refresh after component destruction. The aggregate test mounts the assisted retry and current exercise together, clears one while the other remains dirty, and confirms refresh happens only after both clear. Its first run exposed a test assumption: prior sessions in the shared synthetic learner cause repeated questions to be recorded as assisted. The assertion now verifies persisted answers without assuming an evidence label. The focused run passed 6/6 cases across desktop and mobile.
- **Full E2E:** 98/98 tests passed across both browser profiles (49 desktop, 49 mobile; 0 failed, flaky, or skipped).

## Required local checks

- `npm ci --ignore-scripts` with Node 24.19.0 and npm 11.9.0: passed (566 packages installed).
- `npm run check`: passed; Svelte reported 0 errors and 0 warnings.
- `npm run lint`: passed.
- `npm test`: passed; 85 files and 1,345 tests.
- `npm run test:property`: passed; 5 files and 7 tests.
- `npm run build`: passed.
- `npm run test:e2e`: passed; 98/98 tests using the local built Node server and synthetic fixtures.
- `npm run format:check`: passed across the repository.

## Acceptance boundary

These checks use local synthetic fixtures only. They do not verify a deployed release, availability of updated assets through a production proxy/CDN, or behavior across live application instances. The recovery POST replay was not reproduced in Chromium before the explicit GET navigation was added; other browser engines and production deployment behavior remain unverified. Open tabs need network access for the poll; SvelteKit also checks on responses and when a tab becomes visible or focused. Deployment and live-user acceptance remain pending.

Refresh deferral covers exercise answers and exercise submissions. Unsent text in other forms, such as content reports or deck edits, may be lost if an update reloads the page.
