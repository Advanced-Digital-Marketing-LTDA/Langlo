# QA defense-in-depth layers — owner-approved 2026-10-15

Andrew chose "All recommended" for the layered review stack. Each layer is a separate mechanism, so overlap with Overlock, TestTrust and the merge-evidence gate is intended.

## CI layers

- `.github/workflows/ratchets.yml` runs on every push and pull request with read-only permissions and no secrets. It uses the pinned motchalini-llc test-ratchet v1.0.2, suppress-ratchet v1.0.2 and type-ratchet v1.1.3 (MIT, pure bash grep gates, no installs). Skipped or focused tests, lint suppressions, `any` in non-test TypeScript and `@ts-ignore` can only go down. Baselines are inline numbers; the actions' `baseline-file` input is sourced as shell, so it is not used.
- `.github/workflows/adversarial-review.yml` now prefers a `CLAUDE_CODE_OAUTH_TOKEN` (Claude subscription, made with `claude setup-token`) through `--provider claude`, and falls back to `ANTHROPIC_API_KEY`. It runs `--passes 2 --verify --fail-on high`. adversarial-review 2.11.1 and the Claude Code CLI come from a committed lockfile with integrity hashes in `.github/tools/ai-review`, installed with `npm ci --ignore-scripts` outside the project tree. The CLI is the native `@anthropic-ai/claude-code-linux-x64@2.1.300` package, because the main package needs a postinstall to place its binary. Neither package has dependencies.
- `.github/workflows/claude-review.yml` runs `anthropics/claude-code-action` pinned at `a26b07d8c778b0c43f64618e5fd29fd0f8af72e8` (v1.0.250) with the `pr-review-toolkit@claude-plugins-official` plugin. It runs on same-repository pull requests only and is skipped with a notice until one of the two secrets exists. It may comment on the PR but has no write access to contents. The action's internal `bun install --production` is the owner-accepted exception to the `--ignore-scripts` rule.

## Local layers (before a PR)

- `.claude/settings.json` enables the PR Review Toolkit plugin for the repository.
- The adversarial-review skill 2.11.1 is vendored unchanged under `.agents/skills/adversarial-review` with its Apache-2.0 LICENSE and NOTICE, linked from `.claude/skills/adversarial-review`, and excluded from Prettier.
- AGENTS.md gains a "Before opening a PR" checklist: PR Review Toolkit, adversarial-review, gstack `/cso` and `/test-audit`.

## Local evidence

Baselines were measured on a clean `git archive HEAD` export of the merged branch:

- Test ratchet: TypeScript (`src tests scripts`) 0 skips and 0 `.only`; Python (`tests scripts`) 0. Exit 0.
- Suppression ratchet: TypeScript 0, Python 0. Exit 0.
- Type ratchet: TypeScript `any` is 1, a false positive on the comment "transaction: any failure writes nothing" in `src/lib/server/content-import.ts`, so the baseline is 1. With baseline 0 the gate exits 1, and with baseline 1 it exits 0. Python `Any` is 0.
- A repo-local guard in the same workflow covers `tests/*.e2e.ts` and `tests/*.spec.ts`, which test-ratchet's `*.test.ts`/`*.spec.ts` scope and pattern miss, including Playwright `test.fixme`, `test.fail` and `test.describe.skip`. It found 0 on the clean tree (exit 0), and a planted `test.fixme` in `tests/example.e2e.ts` and `test.describe.skip` in `tests/e2e/auth.spec.ts` each made it exit 1. Both were reverted.
- Red checks: a planted `it.skip` and `// eslint-disable-next-line` in a TypeScript test, a `@unittest.skip` and `# noqa` in a Python test, and a `: any` plus `// @ts-ignore` in a `src` file each made the matching gate exit 1. The planted files were removed. Test files are excluded from the TypeScript `any` count by the action's design.
- `npm ci --ignore-scripts` from `.github/tools/ai-review` into a temporary prefix added 2 packages; the CLI binary printed `2.1.300 (Claude Code)` and `adversarial-review --help` ran.

## Pending

No provider call was made locally. Hosted runs of both AI review workflows are unverified until the owner adds `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` (superseded by the 2026-10-15 update below). The ratchets' hosted run is verified by this PR's CI.

Update, 2026-10-15: this supersedes the "unverified" sentence above. The owner added `CLAUDE_CODE_OAUTH_TOKEN` as a repository secret, and each hosted AI reviewer has one successful subscription run. Claude review re-ran on PR #32 ([run 38745287857, attempt 2](https://github.com/Bonobo791/Langlo/actions/runs/38745287857/attempts/2)), ran the four toolkit agents and posted [a summary comment](https://github.com/Bonobo791/Langlo/pull/32#issuecomment-6199064932). Adversarial review ran on PR #33 at head `136f083` ([run 38784363566](https://github.com/Bonobo791/Langlo/actions/runs/38784363566)), made two review passes and a verification pass, and returned APPROVE. The logs of both runs show the OAuth token set and `ANTHROPIC_API_KEY` empty. The earlier adversarial re-run on PR #32 ([run 38745288044, attempt 2](https://github.com/Bonobo791/Langlo/actions/runs/38745288044/attempts/2)) exited with "Nothing to review — the target scope is empty", because that PR was already merged.

## Haiku-only PR review rollout — 2026-10-15, PR #37

This is **new acceptance work**, not covered by the successful October 15 hosted reviews of PRs #32 and #33 above. Those earlier runs used the then-default model selection; they do not demonstrate that the Haiku-only changes work.

- The PR review workflow explicitly chooses `--model haiku` for the parent review and sets `CLAUDE_CODE_SUBAGENT_MODEL=haiku` plus `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` for toolkit agents that request another model. The adversarial workflow selects `haiku` through the OAuth Claude CLI and `claude-haiku-5-5` through its API-key fallback. The latter fallback has **not** been exercised in hosted CI.
- The pinned Claude Action's optional after-session classifier hardcodes `claude-haiku-4-5`. To prevent a forbidden older-model request, `classify_inline_comments` is disabled and a deterministic `PreToolUse` hook blocks the inline-comment MCP tool unless `tool_input.confirmed === true`; the review prompt instructs agents to confirm only validated findings. This preserves inline commenting without posting unconfirmed probe calls. A local Node test checked `confirmed: true` (exit 0) and false/missing/null/string/malformed inputs (exit 2). **The hook has not yet been validated in a successful hosted model session.**
- On [PR #37](https://github.com/Bonobo791/Langlo/pull/37), the [Claude-review workflow run 38821960921](https://github.com/Bonobo791/Langlo/actions/runs/38821960921) initialized Claude Code with `claude-haiku-5-5`, then failed before review work. The adversarial run also failed during the first provider call. A subsequent temporary, sanitized [diagnostic run 38822263860](https://github.com/Bonobo791/Langlo/actions/runs/38822263860) identified `api_error_status: 429` from the OAuth Haiku request; the diagnostic step was removed afterward.
- Until a hosted review completes using Haiku and the inline-comment guard is observed, **Haiku-only acceptance is pending**. A provider quota/rate-limit failure must remain a failed review, not be treated as a pass or silently fall back to Sonnet/Opus. The merge-evidence gate also requires a human decision because review workflow files changed.
