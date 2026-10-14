# PR 21: 2287caa publication and checks

Published head: `2287caa9d11592b370009893c0d2bf207d9c5929` on
https://github.com/Bonobo791/Langlo/pull/21. The approved description update
succeeded. The PR remains draft and unmerged.

Quality, Dependency review, ESLint, OSSAR, CodeQL, Semgrep and merge-evidence
checks passed on this head. Sonar reported zero new issues; CodeAnt quality
gates passed. Gitar approved the review, confirming all three substantive
findings resolved, including the adapter-address rate-limit fix.

Codacy now reports one clone, meeting its maximum of one. Its remaining
`action_required` result is one high-severity annotation in
`tests/e2e/auth.spec.ts`: `dbFile` is referenced in a helper declared before
the variable. The helper is invoked only after fixture setup assigns the
path, so no runtime failure was observed. A local unpublished cleanup passes
the database path explicitly to the helper, removing that forward reference.

The local cleanup passes formatting, lint, Svelte check (zero errors and
warnings), and all eight desktop auth HTTP tests. No new tests were added;
existing assertions and production behavior are unchanged. No further branch
push was performed.

Readiness was not executed because the applicable Codacy gate has not passed.
Publishing the local cleanup requires another push approval; existing
readiness approval can be used once fresh checks pass. The second review after
readiness therefore remains pending. No merge or deployment was performed.
