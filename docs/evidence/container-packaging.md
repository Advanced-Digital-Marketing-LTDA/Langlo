# Container packaging evidence

- Inspected fetched `main` at `abe6aa7ea332693881ec06aa747637c3bbde4ade` on branch `codex/container-packaging-coolify`.
- `.node-version` pins Node 24.19.0; `package.json` pins npm 11.9.0. The official Node image is pinned to the multi-platform Docker Hub manifest digest in `Dockerfile`.
- `src/lib/server/config.ts` defaults `DATA_ENABLED` to false and validates database/auth/mail requirements only when enabled. `/health/live` returns 200 independently of data configuration; `/health/ready` intentionally returns 503.
- Static assertions for the Dockerfile, Compose environment contract, local-only port binding, ignores, and package manager pin passed. `git diff --check` passed.
- Container build, Compose semantic validation, runtime route/static-asset/health checks, non-root/runtime-version inspection, and SIGTERM verification remain unaccepted: Docker Engine and the Compose plugin are unavailable on this host.
- Repository checks remain unrun: the `npm` shim exits 127, while the available direct npm is 11.17.0 rather than the required 11.9.0. Bootstrapping npm 11.9.0 in `/tmp` stalled without output and was stopped.
- Before enabling data mode, LANGLO-124 / T039 (internal issue 1093) must verify the test database identity, contents, and schema state and complete its separate migration work; pending auth and query-authorization gates must also be accepted. No database was contacted, and no migration or deployment was performed.
