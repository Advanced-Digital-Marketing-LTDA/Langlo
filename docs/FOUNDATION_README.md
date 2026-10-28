# Langlo

Language Grammar Coach has local implementations for public account registration and authentication, grammar practice and assessment, checked curriculum import, native flashcard review, and the Library. This repository does not establish a complete or validated curriculum, a production service, or an accepted learner pilot.

Supported track metadata includes French A1, German A1/A2, English A1/A2, and Portuguese (Brazil) B1/B2. Track metadata does not imply authored coverage or curriculum completeness. The original private two-learner pilot restriction was superseded by later owner-approved public self-registration; see [owner decisions](decisions.md).

## Local setup

Use Node 24.19.0 and npm 11.9.0. Run `npm ci`, then `npm run check`, `npm run lint`, `npm run format:check`, `npm test`, `npm run test:property`, `npm run build`, and `npm run test:e2e`. Install test Chromium with `npx playwright install --with-deps chromium` on an ordinary development machine. A preinstalled browser can be selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

Start local development with `npm run dev`. Start the built Node server with `HOST=127.0.0.1 PORT=3000 npm start`. `DATA_ENABLED=false` supports the public preview without a database; authenticated learner flows require configured data and auth. Use disposable fixtures for local database checks. The Compose guide documents source deployment policy, but does not establish a deployed service or live proxy topology.

The fixture harness uses POSIX filesystem permissions and is verified on Linux. Tests use synthetic accounts and disposable file-backed libSQL databases; fixture tools refuse network URLs and non-fixture targets. Liveness is separate from readiness. The repository's source includes a production configuration path, but production database provisioning/migrations, live proxy behavior, provider delivery, and production route acceptance remain unverified. SMTP recovery is wired locally, while live mail delivery is unverified.

Anki support is currently one-way private text export. The historical T003 `.apkg` artifacts are a separate feasibility spike, not a runtime integration; there is no Windows connector or two-way delivery. See [flashcard architecture](flashcard-architecture.md).

## Boundaries and evidence

See [routes](routes.md), [environment](environment.md), [schema](schema.md), [content import](content-import.md), [testing invariants](testing-invariants.md), and `docs/evidence/T006.md` through `docs/evidence/T009.md`. Local implementation and fixture evidence do not establish live-provider, deployment, curriculum-truth, or learner-acceptance gates.

## Source provenance and license

The setup follows App-Bootstrap-ADM at b658231eb20d8920a538ac355a4563c1e4c53096: https://github.com/Bonobo791/App-Bootstrap-ADM/tree/b658231eb20d8920a538ac355a4563c1e4c53096. It is guidance and templates, not an app scaffold. No Moderaty application source, branding, credentials or learner records were copied. `BOOTSTRAP-LICENSE` preserves attribution for the source guidance.

T001 selected PolyForm Shield 1.0.0. Its license text is now present in `LICENSE`, with licensing guidance in `COMMERCIAL.md` and package metadata pointing to `LICENSE`. This local license status does not imply remote publication or deployment.
