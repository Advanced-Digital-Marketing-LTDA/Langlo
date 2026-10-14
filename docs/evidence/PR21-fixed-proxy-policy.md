# PR 21 repository-owned direct proxy policy

Base: `a5cb4a91e7bfade3b600ce6200a19236b91c8fc2`, branch
`codex/config-error-safe-diagnostics`. PR 21 was open and unmerged at that head
before edits. This follow-up is local and unpublished.

## Verified cause and scope

Installed adapter-node 6.0.0 reads `ADDRESS_HEADER` and `XFF_DEPTH` at startup.
An empty header uses the socket address, grouping users behind the same proxy.
With `x-forwarded-for`, depth one selects the rightmost address. Better Auth
1.7.7 is configured to use only Langlo's overwritten internal address header.
Changing that internal header alone cannot configure adapter extraction.

Compose now fixes the header to `x-forwarded-for` and depth to `1`, with no
operator interpolation. The local Compose override clears the header for direct
development access. Production auth rejects missing or differing settings;
auth also rejects a missing/malformed selected IP. API extraction failures are
caught and return a generic 503 with the request correlation ID. Login/reset
forms use the same existing safe auth dispatcher as signup/recovery, catching
synchronous extraction errors. Public pages, account GETs and liveness do not
require client-address extraction. Validation and secret-safe logs remain intact.

## Trust boundary and acceptance gap

Policy targets only browser -> direct Coolify Traefik -> web, with no public
host port or other untrusted route to the container. Traefik must append its
observed peer address to X-Forwarded-For. The upstream reference implementation
appends the peer after prior values:
https://github.com/traefik/traefik/blob/v3.6/pkg/proxy/httputil/proxy.go#L39

This source reference is not evidence of the deployed version or settings.
Tests simulate that last-hop contract; they do not run or inspect live Traefik.
Header configuration cannot authenticate a network peer by itself. A direct
container bypass, middleware replacing the appended identity, or an additional
proxy/CDN can invalidate this topology or group clients again. Deployment ingress
isolation, actual append behavior and the absence of bypasses remain acceptance
checks. No extra user-managed address environment variables were introduced.

## Validation

- Unit red: 8 new cases failed against the original helper, with 3 passing.
- HTTP red against the previous build: expected 503, received 500 on absent
  address header.
- Focused unit green: 11 tests passed (missing/wrong policy, malformed selected
  address, valid IPv4/IPv6 and forged internal header replacement).
- Full unit suite: 299 tests passed; property suite: 3 tests passed.
- Build, lint and Svelte check passed (0 errors/warnings after correcting test
  typing).
- Clean synthetic Compose rendering, dotenv disabled: production fixed
  `x-forwarded-for` / `1`, even with conflicting interpolation inputs;
  no production published port. Local override: empty header, loopback port only.
- Initial browser run lacked Playwright's bundled Chromium; rerun used the
  installed `/usr/bin/chromium`. An intermediate new-fixture failure was CSRF
  rejection (403); the fixture was corrected to declare its HTTP protocol.

Final browser suite: 62 tests passed on desktop/mobile with system Chromium.
Full formatting check passed; git diff --check passed.

No website-copy tests added. No real credentials, database/provider access,
Coolify access, production configuration, migration, publication, merge or
deployment was performed. Separate importer work was untouched.
