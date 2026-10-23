# Main conflict resolution and database token rename

Date: 2026-10-23. Local validation uses Node 24.19.0 and npm 11.9.0.

## Scope and preservation

Local main was one commit ahead and 71 commits behind the recorded origin/main.
The add/add conflict in `.rewardguard.toml` was resolved with the upstream file.
Merge commit `8857d72` has the same tree as upstream commit `333d34d`.
No upstream migration SQL, snapshots or journal entries were edited.

The original uncommitted analytics work is retained in Git stash
`Pre-main-conflict-resolution local work 2026-10-23`. Restoring it conflicted
with newer upstream analytics; the owner selected keeping upstream analytics
and retaining the stash. A second backup is under
`/tmp/langlo-main-conflict-backup`. Private `.claude/settings.local.json`
remains untracked and untouched.

The owner then approved a new PR containing their Compose edit and this evidence,
and confirmed `TURSO_AUTH_TOKEN_2` as the new repository design. The approved
scope includes completing that rename in private runtime declarations,
configuration validation, content import, remote-test migration tooling,
synthetic tests, the example environment and operator documentation.
No credential values are included in the change, and no deployed settings were changed.

## Behavior evidence

Tests were changed before the implementation. The configuration-only red run
reported `5 failed | 23 passed (28)` and included
`ConfigError: Invalid TURSO_AUTH_TOKEN` when only the new variable was supplied.
The initial four-file red run reported `13 failed | 99 passed (112)`;
two CLI failures in that run were sandbox-related rather than rename failures.

After updating the readers and diagnostic names, the same four affected test
files passed: `113 passed (113)`. The new regression verifies that the old
variable alone is rejected and that the new variable takes precedence when
both names are present. Existing tests verify trimming, missing/blank tokens,
redacted failures, selected local database behavior and injected CLI connections.
Remote-looking test targets use synthetic values and injected local clients;
no live remote database or provider call was made for this change.

Logs are local under `/tmp/langlo-main-token-*.log`; initial merge checks use
`/tmp/langlo-main-merge-*.log`.

## Required validation

- `npm ci --ignore-scripts --offline --cache /tmp/langlo-npm-cache`: passed,
  566 packages installed. The online attempt was interrupted after stalling.
- `npm run check`: passed after the rename.
- `npm run lint`: passed after the rename.
- `npm run format:check`: reports the pre-existing untracked
  `.claude/settings.local.json`; that private file is intentionally untouched.
  A separate check of tracked regular files plus this evidence passed after the rename.
- `npm test`: after the rename, 106 files and 1,858 tests passed.
- `npm run test:property`: passed after the rename, six files and nine tests.
- `npm run build`: passed after the rename.
- `npm run test:e2e`: all 144 built-server browser tests passed after the rename
  in the final sequential run (2m 22s). This environment requires an unrestricted local
  server socket and the existing cached Chromium executable via
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

Synthetic test Git repositories inherit disabled global SonarJS/Codacy hooks
to avoid unrelated global analysis during fixture commits. An earlier full run
was interrupted after fixture commits inherited global Codacy analysis. The initial merge
commit's SonarJS hook reported six existing upstream findings; the owner approved
its bypass. The two SonarJS findings in the touched configuration file are
byte-for-byte identical to the output for upstream main: existing cognitive
complexity and regex-style findings. No unrelated refactor was added.
Credential-using Codacy analysis is not part of the acceptance claim.

An initial post-rename browser run overlapped the full unit suite, whose
`tests/sentry-vite-config.test.ts` rebuilds the app. Browser version-check
timeouts made that concurrent run unreliable, so it was interrupted. The final
browser run follows a fresh build and runs without concurrent unit tests.

## Review and pending acceptance

The Compose-only change initially left the runtime reading the previous name.
That high-severity configuration mismatch is resolved by the approved complete
rename. Direct runtime and CLI operators must supply `TURSO_AUTH_TOKEN_2` when
upgrading; there is no compatibility fallback to the old variable.

Local adversarial review used the repository's adversarial-review skill,
offline in the current session, with no additional model or provider call.
The original configuration mismatch is fixed, all remaining reads of the old
name are intentional regression coverage or upgrade/historical documentation,
and no migration, learner scoping, secret exposure or workflow change is included.
The review result is:

```json
{
  "verdict": "approve",
  "summary": "No remaining material findings in the complete token-name rename and conflict-resolution evidence.",
  "coverage": {
    "files_examined": [
      ".env.example",
      "compose.yaml",
      "docs/content-import.md",
      "docs/deployment/docker-compose.md",
      "docs/deployment/remote-test-migrations.md",
      "docs/environment.md",
      "docs/evidence/main-conflict-resolution.md",
      "scripts/content-import.ts",
      "src/env.ts",
      "src/lib/server/config.ts",
      "src/lib/server/db/remote-migrate.ts",
      "tests/config.test.ts",
      "tests/content-import-script.test.ts",
      "tests/db-cli.test.ts",
      "tests/db-remote-migrate.test.ts"
    ],
    "files_skipped": []
  },
  "findings": [],
  "next_steps": [
    "Operators must update direct runtime and CLI environment variable names before deployment.",
    "Assess CI results separately after PR creation."
  ]
}
```

The owner approved pushing only `codex/resolve-main-conflict` and opening its
PR against main in `Advanced-Digital-Marketing-LTDA/Langlo`. Local checks do not prove live provider behavior,
Windows Anki, CI, deployment or release success.
No AI review workflow was manually dispatched. No production database or real
provider was used for verification.
