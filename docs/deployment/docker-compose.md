# Docker Compose deployment

The repository builds the adapter-node app into a non-root Node 24.19.0 image. The image health check calls `GET /health/live`, and Compose inherits it. `compose.yaml` defines one `web` service and exposes container port 3000 to Coolify's proxy without publishing a host port. Turso and Proton SMTP remain external services. The image and startup command do not run migrations.

## Coolify settings

Create an application from the Bonobo791/Langlo repository and select:

- **Build pack:** Docker Compose
- **Base directory:** `/`
- **Docker Compose file:** `compose.yaml`
- **Compose deployment:** normal Compose deployment (not Raw/as-is)
- **Auto deploy:** Manual deployments, under Advanced → Deployment
- **Domain:** add the public HTTPS domain to the `web` service, targeting internal port `3000`
- **Runtime environment:** set `APP_ORIGIN` to that same public HTTPS origin, for example `https://langlo.example.org`

Do not add a host port mapping in Coolify. The Compose `expose` declaration makes port 3000 available to the proxy. Add operator-owned values under the application's runtime Environment Variables; do not set them as build arguments. Compose defaults `DATA_ENABLED` to `false`, so `DATABASE_URL`, `TURSO_AUTH_TOKEN`, `BETTER_AUTH_SECRET`, and SMTP credentials may remain unset for synthetic preview mode. No database or SMTP container is part of this stack.

Runtime variables follow `src/lib/server/config.ts`: `APP_ENV` defaults to `production`, `APP_ORIGIN` must be an HTTPS origin in production, `APP_BUILD_SHA` defaults to `unknown` (or accepts a 40-character lowercase Git SHA), and `DATA_ENABLED` defaults to `false`. Data/auth require `DATABASE_URL=libsql://...`, `TURSO_AUTH_TOKEN`, and a `BETTER_AUTH_SECRET` of at least 32 characters. Recovery additionally requires `MAIL_TRANSPORT=smtp`, `MAIL_FROM`, and `PROTON_SMTP_TOKEN`; invalid mail configuration does not disable signup or sign-in. `SMTP_HOST` and `SMTP_PORT` default to `smtp.protonmail.ch` and `587`. `BODY_SIZE_LIMIT` defaults to 524288 bytes (512 KiB) and is handled by adapter-node. Supply every secret through Coolify at runtime.

The repository owns the client-address policy for the documented direct browser → Coolify Traefik → web topology: Compose sets `ADDRESS_HEADER=x-forwarded-for` and `XFF_DEPTH=1` as fixed values. No additional operator environment variables are required. Adapter-node selects the rightmost address appended by the last proxy; Langlo replaces incoming internal address headers with that selected IP before auth rate limiting. Production auth rejects a missing/changed policy, and missing or invalid client addresses return generic unavailable responses for auth operations only. Public pages, account page GETs and liveness remain available. The local override clears the address header for direct loopback development.

This policy requires Traefik to append its observed peer address and to be the only ingress to port 3000. Do not enable an option that suppresses that append or add a middleware that replaces the selected address with arbitrary incoming data. No host port is published by this repository. A CDN, additional ingress hop, direct container access, or an altered Traefik forwarding policy needs a separate trust design; this setting does not prove that production isolation or sanitization is correct. Production topology and forged-header behavior remain acceptance checks, not claims established by local tests.

Do not set `DATA_ENABLED=true` until LANGLO-124 / T039 (internal issue 1093) verifies the test database's identity, contents, and schema state and completes its separate migration work; the pending auth and query-authorization gates are accepted; and the owner authorizes enabling real pilot accounts. This container task does not connect to or migrate any database.

## Local synthetic preview

With Docker Engine and the Compose plugin installed, run from the repository root:

```sh
APP_ORIGIN=http://localhost:3000 docker compose -f compose.yaml -f compose.local.yaml config
APP_ORIGIN=http://localhost:3000 docker compose -f compose.yaml -f compose.local.yaml up --build
```

Open `http://localhost:3000`. The local override binds only to `127.0.0.1`; it selects development mode and keeps `DATA_ENABLED=false`. The liveness route is `GET /health/live`; `/health/ready` intentionally remains 503 while the application foundation gates are pending. Stop with Ctrl+C; adapter-node handles SIGTERM gracefully, and Compose allows 35 seconds for its default 30-second shutdown window.
