# Connect Langlo to GlitchTip

Host GlitchTip as a standalone service managed in Coolify, independently of
the Langlo repository. Keep the existing Langlo resource pointed at the root
`compose.yaml`.

## Set up the standalone service

Create a Docker Compose Empty resource in Coolify using the
[GlitchTip installation guide](https://glitchtip.com/documentation/install/).
Manage its Compose configuration, database password, secret key, SMTP settings,
persistent storage, backup schedules, and 30-day retention in that resource.
Create the initial administrator before exposing its public domain, then
create an organization and a project for Langlo. Configure project email alert
rules and recipients in GlitchTip.

If replacing an existing GlitchTip resource, back up its database and uploads
and arrange to preserve or restore them before switching resources. A new
Coolify resource can create new volumes. The former deployment files remain
available in Git history; save the configuration independently before removing
the old resource.

See [Coolify's Docker Compose guide](https://coolify.io/docs/applications/builds/docker-compose)
for service configuration and public domain routing.

## Configure the existing Langlo resource

Copy the Langlo project's DSN from GlitchTip into Langlo's Coolify environment:

| Variable                                   | Value                                             |
| ------------------------------------------ | ------------------------------------------------- |
| `PUBLIC_GLITCHTIP_DSN`                     | The DSN issued by the GlitchTip project           |
| `APP_ENV` and `PUBLIC_APP_ENV`             | Matching environment labels, such as `production` |
| `APP_BUILD_SHA` and `PUBLIC_APP_BUILD_SHA` | The commit deployed by Langlo                     |

Redeploy the existing Langlo resource after saving the variables. The public
DSN routes SDK events to the project; SMTP credentials, the database password,
and GlitchTip's secret key belong only in the standalone GlitchTip resource.
Leave the DSN empty to disable telemetry transmission.

## Verify the connection

Use synthetic data to confirm browser and server errors reach the project,
sampled performance transactions appear, logs appear in the project's Logs
view, and email alerts arrive. Langlo
samples performance traces at 10% and forwards the event and span fields captured
by the Sentry SDK without Langlo-side filtering. Langlo's custom telemetry
scrubbers have been temporarily removed. The pass-through change did not alter
SDK capture settings. Treat telemetry as potentially containing learner
content, secrets, request metadata, and client identifiers. Langlo uses the
Sentry-compatible SDK with the static transaction lifecycle for GlitchTip 6
compatibility.

## Logs

Langlo registers the SDK's console log capture on the server and in the
browser, so `console.*` calls are recorded as logs at their own level (a
`console.log` is recorded as `info`) and sent to GlitchTip with no Langlo-side
filtering. This is intentional for the alpha and carries the same exposure as
the other telemetry above, including raw error objects such as the
`console.error` calls in `src/lib/server/study.ts`. Source inspection of
`@sentry/core` and `@sentry/sveltekit` 11.8.0 shows no `enableLogs` option, so
none is set; delivery to GlitchTip itself is not yet verified.

Langlo itself writes few console lines, so the server also sends one `info`
log per request (`METHOD /path status`, with method, path, status,
`duration_ms` and `correlation_id` attributes) from `src/lib/server/request-log.ts`.
The path is the raw URL path with no query string, except that the token in
`/api/auth/reset-password/<token>` is logged as `:token`, so live reset tokens
never reach GlitchTip. A request that throws is logged at `error` level with
status 500 and then rethrown. `/health/live` is skipped.

The GlitchTip service must accept logs: set `GLITCHTIP_ENABLE_LOGS=True` on the
standalone resource and redeploy it, and set log retention to 30 days there.
To verify, call `console.warn` with a recognizable message from the deployed
server and from a browser session, then find both in the Logs view.

Langlo's tests validate SDK configuration and verify that no custom telemetry
field filtering is configured. They do not prove live event ingestion, email
delivery, backups, or retention cleanup; verify those against the standalone
service.
