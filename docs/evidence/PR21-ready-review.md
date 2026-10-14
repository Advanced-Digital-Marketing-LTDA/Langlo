# PR 21 readiness and second review

Snapshot: 2026-10-14, published head
`e5e3263956ad0d4605da6e4108468539acfd776a`.

PR https://github.com/Bonobo791/Langlo/pull/21 was marked ready after applicable
exact-head checks passed. Quality, Dependency review, ESLint, OSSAR, CodeQL,
Semgrep, Sonar, Codacy, CodeAnt gates and merge-evidence passed. The additional
neutral scan-configuration notice is unchanged. No merge or deployment occurred.

Codex's readiness-triggered review completed without posted findings. Gitar's
report confirmed its three substantive findings resolved. CodeRabbit completed
with one change request: verify the proxy client-address forwarding policy
before exposing public signup. It also reported 50% helper docstring coverage
against its 80% target.

## Local preparation

Compose now exposes optional `ADDRESS_HEADER` and `XFF_DEPTH` values to the
adapter. The empty-header/socket fallback remains conservative; depth defaults
to the adapter's existing value of one. No real proxy header or hop count was
chosen. Documentation requires verified edge sanitization and trusted-hop
selection before public accounts are activated behind a proxy. Requiring a
forwarding header for every production request would also reject legitimate
direct connections, so no global auth failure condition was added.

Docker Compose 2.40.3 config validation used a clean synthetic environment with
dotenv loading disabled. Default values rendered as empty header / depth one;
explicit fixture values rendered unchanged. Prettier, lint and Svelte checks
passed. Application source edits are documentation only; no test assertions
changed and no tests were added. Missing helper documentation was added manually; fresh CodeRabbit
analysis is needed to measure its coverage result.

The source preparation is unpublished and requires another push approval.
The actual deployment policy remains unverified: determine which header the
trusted proxy overwrites and the trusted hop depth before setting those live
runtime values. No production configuration was inspected or changed.
