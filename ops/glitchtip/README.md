# GlitchTip on Coolify

This is a separate GlitchTip stack. Deploy `compose.yaml` as its own Coolify
application and keep the PostgreSQL and uploads volumes persistent. Do not add
the public domain route yet: on a fresh database, GlitchTip permits the first
user and organization even when public registration is disabled.

Set these variables in Coolify, not in this repository:

- `GLITCHTIP_POSTGRES_PASSWORD`: generate a long hexadecimal password so the
  value is safe inside the PostgreSQL URL.
- `GLITCHTIP_SECRET_KEY`: generate a separate long random value.
- `EMAIL_URL`: Proton SMTP URL with URL-encoded credentials.
- `DEFAULT_FROM_EMAIL`: verified sender address for alerts.

The Compose file keeps account registration, organization creation, Django
admin, OpenAPI, MCP, log ingestion, and uptime monitoring disabled. After
deploying without a public route, create the initial administrator with
`./manage.py createsuperuser` in the GlitchTip container. Then route
`glitchtip.advanceddigitalmarketingltda.com` to service `glitchtip` on port
`8000`, create the organization and Langlo project, configure email alert rules
and recipients, and copy the project DSN into Langlo's Coolify environment as
`PUBLIC_GLITCHTIP_DSN`.

Langlo also uses `APP_ENV` and `APP_BUILD_SHA` on the server. Set the matching
public values `PUBLIC_APP_ENV` and `PUBLIC_APP_BUILD_SHA` for browser release
labels. The DSN is public SDK configuration; never put SMTP credentials or
GlitchTip's secret key in Langlo or the browser.

All configured retention periods are 30 days. Log ingestion and uptime
monitoring are disabled. Performance traces begin at a 1% sample rate in
Langlo. Event and trace payloads are filtered in the SDK before transmission.

Back up the PostgreSQL and uploads volumes before upgrades. GlitchTip runs
database migrations during startup; review its release notes before changing
the image major version. The image is pinned to major version `6` so compatible
minor releases can be received without switching to an unbounded `latest` tag.
