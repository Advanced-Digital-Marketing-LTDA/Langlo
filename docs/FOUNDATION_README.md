# Langlo

Language Grammar Coach is a private two-learner grammar app planned for French A1, German A1/A2 and English A1/A2. This repository currently contains the local application foundation, not a completed curriculum or pilot release.

## Local setup

Use Node 24.19.0 and npm 11.9.0. Run npm ci, npm run check, npm run lint, npm run format:check, npm test, npm run test:property, npm run build and npm run test:e2e. Install test Chromium with npx playwright install --with-deps chromium on an ordinary development machine. A preinstalled browser can be selected with PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.

Start local development with npm run dev. Start the built Node server with HOST=127.0.0.1 PORT=3000 npm start. Copy .env.example only for local settings; no secrets are needed for this foundation. Production hosting, TLS, reverse-proxy settings and migrations are separate release work.

The fixture harness uses POSIX filesystem permissions and is verified on Linux. Tests use synthetic accounts and disposable file-backed libSQL databases. Fixture tools must refuse any network URL or non-fixture target. The production database is never needed to build or verify the foundation. Runtime database use, maintained authentication, curricula, assessment, SMTP recovery and Windows Anki delivery are pending.

## Boundaries and evidence

See docs/bootstrap.md, docs/bootstrap-tasks.md, docs/routes.md, docs/environment.md, docs/schema.md, docs/testing-invariants.md and docs/evidence/T006.md through T009.md for exact results and limits. Liveness is separate from readiness; a running server is not a working product. The Windows loopback spike requires a separately authorized device.

## Source provenance and license

The setup follows App-Bootstrap-ADM at b658231eb20d8920a538ac355a4563c1e4c53096: https://github.com/Bonobo791/App-Bootstrap-ADM/tree/b658231eb20d8920a538ac355a4563c1e4c53096. It is guidance and templates, not an app scaffold. No Moderaty application source, branding, credentials or learner records were copied. BOOTSTRAP-LICENSE preserves attribution for the source guidance.

T001 records the owner’s selection of PolyForm Shield 1.0.0, matching Bonobo791/Moderaty’s LICENSE. package.json remains UNLICENSED and private until a separate license-file and metadata implementation. The repository is Bonobo791/Langlo; no remote publication or deployment is implied by this local work.
