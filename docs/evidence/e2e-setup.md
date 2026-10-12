# Agentic E2E setup evidence

Date: 2026-10-12

## Setup

- Initialized `e2e` with the web engine, its generated skill and MCP
  registrations, and the Vercel AI Gateway defaults.
- Selected ChatGPT and configured `chatgpt('gpt-6-luna')` through
  `e2e/oauth/chatgpt`; `e2e models` listed that model after login.
- The target starts the built Node server on `127.0.0.1:4175` behind a local
  test proxy at `localhost:4174`, with `APP_ENV=test`. The proxy restores a
  same-origin header only for sandboxed browser form posts whose Origin is
  opaque (`null`); application CSRF checks remain enabled.
- `tests/auth-lifecycle.e2e.ts` provisions a synthetic learner in a disposable
  SQLite fixture, submits the actual login, sign-out, and recovery forms, and
  verifies the captured reset email. `tests/prototype-practice.e2e.ts` completes
  the recommended subject-pronoun lesson. The smoke test is
  `tests/example.e2e.ts`.
- `playwright.config.ts` now starts `node build` directly so its `PORT` and
  `HOST` test settings reach the built Node server.
- npm 11.9.0 was invoked through `pnpm dlx npm@11.9.0` because the container's
  `npm`/`npx` shims cannot find their distrobox commands.
- Installed Fedora Chromium runtime packages in the Distrobox:
  `nspr`, `nss`, `nss-util`, `atk`, `at-spi2-atk`, `at-spi2-core`, `dbus-libs`,
  `libXcomposite`, `libXdamage`, `libXfixes`, `libXrandr`, `libxkbcommon`,
  `alsa-lib`, `fontconfig`, and `google-noto-sans-fonts`.
- The mounted home has Fontconfig caches from a newer version than Fedora's
  runtime. Browser runs used a fresh cache under `/tmp` while reusing the
  installed browser:
  `XDG_CACHE_HOME=/tmp/e2e-fontconfig-cache PLAYWRIGHT_BROWSERS_PATH=/home/user/.cache/ms-playwright`.

## Local checks

| Check                    | Result                                                             |
| ------------------------ | ------------------------------------------------------------------ |
| `npm ci`                 | Passed; 280 packages installed, zero reported vulnerabilities      |
| `npm run check`          | Passed; 0 errors and 0 warnings                                    |
| `npm run lint`           | Passed                                                             |
| `npm run format:check`   | Passed                                                             |
| `npm run build`          | Passed                                                             |
| `npm test`               | Passed with subprocess permission; 282 tests passed                |
| `npm run test:property`  | Passed; 3 tests passed                                             |
| `npm run test:e2e:agent` | Passed; 3 browser tests                                            |
| e2e smoke test           | Passed; 1 test                                                     |
| e2e learner flow         | Passed; 2 ChatGPT agent steps, 4 correct answers, results verified |
| e2e auth flow            | Passed; form redirects, logout, confirmation, and captured mail    |
| `npm run test:e2e`       | Passed; 56 desktop and mobile tests                                |

Initial browser runs failed because Chromium libraries were missing. After
installing the Fedora packages, Chromium exposed an incompatible mounted
Fontconfig cache and crashed on the first practice-page advance. A fresh cache
under `/tmp` removed the crash. The first broad Playwright run was interrupted
after its `npm run start` web server bound the default port; changing the
server command to `node build` made it honor the configured test port, and the
final run passed all 56 tests.

## Pending acceptance

The test setup and local browser flows are verified. The environment-specific
Fontconfig cache override is needed while the newer host cache remains mounted
into this Fedora Distrobox.
