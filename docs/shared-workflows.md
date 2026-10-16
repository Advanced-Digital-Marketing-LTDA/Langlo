# Shared CI workflows

Langlo hosts the reusable workflows that other repos in the
Advanced-Digital-Marketing-LTDA org call: `reusable-ossar.yml`,
`reusable-dependency-review.yml`, `reusable-adversarial-review.yml` and
`reusable-claude-review.yml`. Each caller repo has a thin workflow that sets
its own triggers and permissions and points `uses:` at one of these files.

## Trust

The authorization in `AGENTS.md` covers Anthropic calls from Langlo's two
named review workflows on same-repository pull requests. The presence of a
reusable workflow does not authorize a caller in another repository to use
credentials or make provider calls. Each caller's owner must authorize that
use separately before enabling AI review; this document grants no additional
authorization and requires no new secrets.

A caller runs this repo's workflow code with the caller's permissions. For
example, the OSSAR job has `security-events: write` on every caller. A change
merged to Langlo `main` is therefore code that runs in every repo that adopts
it. Review changes to `reusable-*.yml` like changes to production CI.

## Pinning

Callers pin `uses:` to a full commit SHA of Langlo `main`, never a branch or
tag, and note the Langlo PR in a comment on the line above. Merging a change
here affects no caller until that caller's pin is bumped.

To bump a pin:

1. Merge the Langlo PR first and take the merge commit SHA from `main`.
2. Open a PR in each caller that changes the SHA and its comment. For
   `reusable-adversarial-review.yml`, update the `tools-ref` input to that
   same full SHA so the review-tool lockfile and workflow remain aligned.
3. Check that the caller's run lists the new SHA under referenced workflows
   and, for adversarial review, checks out its tools at that identical SHA.
   Check that the job passes before merging. The workflow's 40-hex check
   validates the format of `tools-ref`; it does not establish equality with
   the caller's `uses:` pin.

Callers may sit on different Langlo commits. That is fine when the workflows
they call are identical at both commits.

## OSSAR scope

`reusable-ossar.yml` runs `templateanalyzer` and `trivy` with the `GitHub`
policy. ESLint, bandit and binskim are left out on purpose. The bundled ESLint
config only matches `.js` files, so repos with `.ts` and no `.js` files failed
with every file ignored. An explicit tool list forces every named tool to run,
and bandit and binskim abort when a repo has no Python files or binaries. This
means the shared workflow does no Python or JavaScript static analysis.
`tests/reusable-review-workflows.test.ts` pins the exact tool list.
