# Automatic Playwright browser environment

Date: 2026-10-16. Owner approved the six-file scope in the conversation. Isolated managed worktree: `/home/user/.codex/worktrees/d732/Langlo`, branch `codex/playwright-environment`, initially based on committed `6d50191` from the existing `ci/codecov-coverage` checkout. On the owner's subsequent push request, only the six-file feature commit was rebased onto verified remote main `0cfaa1c41cd2b8530aa431bfdffc1d8f1fe601b3`, excluding the three unpublished Codecov/guidance commits. The original checkout's uncommitted Stryker work was not copied or edited. The previously published holdout branch remains separate.

## Change

- `playwright.config.ts` prepares browser launch environment and registers the global preflight. Existing executable override, desktop/mobile projects, built Node server, assertions, timeouts, retries and worker count are preserved.
- `scripts/playwright-environment.mjs` allocates a fresh Linux browser `XDG_CACHE_HOME` under the resolved system temporary directory. The runner's cache and browser-download resolution are unchanged. An internal marker shares the directory with workers; only its allocating process registers cleanup. Global teardown and startup failure remove owned directories, with a process-exit fallback for early failures and `--list`.
- The preflight launches the configured Chromium, renders a synthetic heading with no application or provider request, and rejects null or non-positive text dimensions. Browser launch errors and rendering errors produce one setup failure with the original cause. It checks every platform; only Linux changes cache environment.
- `tests/playwright-environment.test.ts` covers cache isolation, preserved environment/download/executable settings, independent runs, owner-only idempotent cleanup, worker sharing, non-Linux preservation, text dimensions and a real missing-executable failure.
- `.github/CODEOWNERS` explicitly lists the validator test twin. `docs/environment.md` documents setup and diagnostics.

No dependency, workflow, application, database, curriculum, desktop or host-font configuration changes. Implementation and validation used no deployment, model-provider call or tracker update. Remote publication was separately authorized by the owner's follow-up `push` request. Temporary diagnostic fixtures and logs use `/tmp` only.

## Observed red and green

Before implementation, the tests ran against a no-op helper stub retaining the old environment behavior:

```text
vitest run tests/playwright-environment.test.ts
Test Files 1 failed (1)
Tests 7 failed | 3 passed (10)
```

The host cache was reused, independent runs shared it, workers had no allocated directory, zero/null dimensions were accepted, and setup resolved rather than reporting a missing browser. An initial draft also generated undefined-path setup errors; those test inputs were corrected before recording the final assertion-based red above. Non-Linux preservation and the valid-dimensions positive control already passed.

After implementation:

```text
vitest run tests/playwright-environment.test.ts
Test Files 1 passed (1)
Tests 10 passed (10)
```

The real-browser checks below supplement the ordinary tests without requiring browser binaries during the ordinary CI suite, which runs before CI installs browsers.

## Validation

Node **24.19.0**, npm **11.9.0**. Pinned dependencies installed with lifecycle scripts disabled; required validation ran explicitly. The initial `6d50191` baseline passed 813 tests, and the implementation on that base passed 823. Before publication, all required checks were rerun on remote main `0cfaa1c` plus only this six-file change. The table below records that publication tree; its 821 tests exclude the two tests from the unpublished Codecov work.

| Command                                           | Observed result                                  |
| ------------------------------------------------- | ------------------------------------------------ |
| `npm ci --ignore-scripts`                         | Success; 280 packages, zero vulnerabilities      |
| `npm run check`                                   | 0 errors, 0 warnings                             |
| `npm run lint`                                    | Pass                                             |
| `npm run format:check`                            | Pass                                             |
| `npm test`                                        | 41 files, 821 tests passed, including properties |
| `npm run test:property`                           | 4 files, 5 properties passed                     |
| `npm run build`                                   | Built Node adapter successfully                  |
| `npm run test:e2e` with no manual font workaround | **72 passed**, desktop and mobile, 34.5 seconds  |
| `git diff --check`                                | Pass                                             |

The full browser command removed any inherited `FONTCONFIG_FILE` or internal cache marker only to prove the new default behavior. No manual `XDG_CACHE_HOME`, browser-download-path override or alternate browser executable was supplied. It used the installed Playwright Chromium 1243 (153.0.8010.12). The preflight passed before all 72 existing scenarios. No existing E2E source or assertion changed. A second full invocation after the failure controls also passed all 72 scenarios in 35.8 seconds; no owned font-cache directories remained afterward. Its log is `/tmp/langlo-playwright-env-final-e2e.log`.

### Real failure and cleanup controls

Two separate fixture-driven CLI runs used the existing desktop `public shell works` selection to check setup failure before any scenario execution:

1. A temporary `FONTCONFIG_FILE` pointed at an empty font directory. The actual browser produced zero-height text; setup exited 1 with one top-level `Playwright browser preflight failed` error and the `Browser text has no visible dimensions` cause. The scenario did not start.
2. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` pointed at a nonexistent file in a disposable directory. Setup exited 1 with the same top-level diagnostic and the missing-executable cause. The scenario did not start, demonstrating that the existing executable override is honored.
3. A normal `npm run test:e2e -- --list` exited 0 and listed 72 scenarios without launching preflight.

For each CLI control, the set of new `/tmp/langlo-playwright-fonts-*` directories remaining after exit was empty. Unit tests separately retained an unrelated host-cache sentinel while cleaning generated cache contents, and proved that inherited worker cleanup cannot remove the allocating process's cache. The disposable invalid font/browser fixtures were removed after the probes. The first diagnostic harness counted the error text twice because Playwright also prints its source excerpt; the corrected harness counts top-level `Error:` entries and observed one error per failure.

Publication-tree logs: `/tmp/langlo-playwright-publish-{ci,check,lint,format,test,property,build,e2e}.log`; exit codes are recorded in `/tmp/langlo-playwright-publish-results.json`. Earlier implementation logs: `/tmp/langlo-playwright-env-{ci,baseline,red,green,final-check,final-lint,format-check,test,property,build,e2e,no-fonts,missing-browser,list}.log`.

## Acceptance limits

- Local Linux validation is complete for this setup; hosted CI has not been observed. Windows/macOS preservation is covered by the helper tests, not a native OS browser run.
- Cache isolation addresses the reproduced incompatible user-cache failure. It cannot install missing OS libraries or fonts; preflight reports those failures instead of skipping tests.
- Explicit custom Fontconfig configuration remains in force. A custom file that forces another unusable cache/font source can still fail preflight.
- The preflight is an environment check, not proof of application correctness or provider/release acceptance. Existing scenario assertions remain the application gate.
