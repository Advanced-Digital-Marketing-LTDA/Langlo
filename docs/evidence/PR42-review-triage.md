# PR 42 review triage: shared review workflows

Scope: `.github/workflows/reusable-adversarial-review.yml`, `.github/workflows/reusable-claude-review.yml`.

## Red (before the fix)

`vitest run tests/reusable-review-workflows.test.ts`: 6 passed, 1 failed.
`rejects a tools-ref that is not a full commit SHA before any checkout`: expected -1 to be greater than -1.

## Green (after the fix)

Same command: 7 passed (7). A short or malformed `tools-ref` now fails the first step with an error before any checkout.

## Adversarial-review HIGH on d75c3c2

`actions/checkout` rejects a `path` outside the workspace, and the tools checkout used `${{ runner.temp }}/langlo-tools`. Red: `checks the tools out inside the workspace, never under runner.temp` failed (path was the runner.temp one). Fix: check out to `.langlo-tools`, copy the lockfile to `$RUNNER_TEMP/ai-review`, then delete `.langlo-tools`. Green: 8 passed (8).

## Claude review turn cap

Langlo's own `claude-review.yml` failed on d75c3c2: "24 turns, exceeding the configured maximum of 18". The owner chose 30 on the decision card. Red: the shared-workflow test expecting `--max-turns 30` failed against 18. Green: all tests pass with 30 in both `claude-review.yml` and `reusable-claude-review.yml`.

## Findings

- `tools-ref` unvalidated: fixed with a first step that requires a 40-character commit SHA.
- No test over the reusable workflows: added `tests/reusable-review-workflows.test.ts` (gate flags, Haiku, turn cap, inline-comment guard, tool allowlist, same-repository condition).
- Unpinned plugin marketplace, self-attested `confirmed` hook, and the `gh pr comment` allowlist: copied unchanged from Langlo's own `claude-review.yml` and not changed here; put to the owner.
- Missing credential skips instead of failing: same opt-in behavior as Langlo's own workflows; put to the owner.

Pending acceptance: the owner review the merge-evidence gate requires for edited workflow files, and the AGENTS.md exception list, which names only the two existing review workflows.
