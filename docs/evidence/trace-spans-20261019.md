# Trace spans around study page database steps

**Symptom:** `/app`, `/app/map`, `/app/progress` and session pages were reported slow (`__data.json` answers of 3.5 s to 10.8 s for about 5 kB). GlitchTip traces showed one long block because database calls and `load` steps were not spans.

**Change:** a `span()` helper (`src/lib/server/tracing.ts`) wraps `Sentry.startSpan`. `studyPage` and `learnerApi` time `study.open-database` and `study.run`; `getMastery` times `mastery.begin-write`, `enrollment-check`, `catalog`, `prerequisites`, `load-evidence` (row count), `current-content`, `record-evidence` (row count) and `commit`. No query, transaction or return value changed. This does not claim a cause for the slowness; it makes the cause visible in traces.

**Red (before instrumenting `getMastery`), `tests/tracing-spans.test.ts`:**

```
Tests  1 failed | 2 passed (3)
- ["mastery.begin-write", "mastery.enrollment-check", ... "mastery.commit"]
+ []
```

**Green (after):** `tests/tracing-spans.test.ts` 7 passed (adds `studyPage` span/close, `studyPage` failure closes the database and rethrows, `learnerApi` spans with a 200, `learnerApi` stale-review error still maps to 409 with its message). Existing `tests/mastery.test.ts` and `tests/mastery-updates.test.ts` pass with the new spans (31 passed across the three files). `learner-routes`, `assessment-routes`, `dashboard` and `mistake-card-routes` pass (60 passed). `eslint`, `prettier --check` and `svelte-check` (0 errors) are clean on the changed files.

**Order of the tests:** the three `getMastery`/helper tests were written first and seen red/green as above. The `studyPage` and `learnerApi` tests were added after the instrumentation, in response to review, and were not seen red.

**Toolchain deviation:** local runs used Node 22.22.0 and npm 10.9.4, not the pinned Node 24.19.0 / npm 11.9.0. `npm ci` failed locally because the lock file was out of sync under npm 10, so dependencies were installed with `npm install --no-package-lock --ignore-scripts --legacy-peer-deps` (lock file untouched). CI on the pinned toolchain is the authoritative check.

**Pending acceptance:** the full test suite was not run locally and is left to CI. Whether the spans identify the slow step needs a deployed trace; GlitchTip samples 10% of requests.
