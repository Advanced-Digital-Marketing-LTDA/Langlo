# Langlo repository guidance

This isolated repository is a local implementation of Language Grammar Coach. Keep code neutral, private configuration server-only, and every learner record owner-scoped. Do not copy branding, credentials, production settings or learner data from other projects.

Use Node 24.19.0 and npm 11.9.0. Run npm ci, npm run check, npm run lint, npm run format:check, npm test, npm run test:property, npm run build and npm run test:e2e. Ordinary tests include properties and must fail with no tests. Browser tests target the built Node server with synthetic fixtures.

Write behavior tests first, record observed red and green output, and preserve unrelated work. Document evidence and pending acceptance in docs/evidence. Local checks do not prove live provider, Windows Anki, CI or release success.

Only disposable local fixture databases may be created or migrated in this phase. No real provider calls, production database, credentials, account access, paid calls, remote publication, deployment, SSH, DNS or desktop access are authorized. T001 records Bonobo791/Langlo as the repository and PolyForm Shield 1.0.0 as the selected license; license-file implementation and remote publication remain pending. Commits may be made locally; do not push.

Keep generated .svelte-kit and build files, database files, real .env files and learner data out of git. Server-only modules must stay in src/lib/server. Fork CI must have no production secrets or privileged write triggers.

CI package installations must use `--ignore-scripts`, including the npm bootstrap, `npm ci`, and auxiliary tool installs. Run required validation explicitly after installation. Quality and ESLint workflows must cover pushes and pull requests on every branch without branch filters. Preserve this policy when creating or updating branch workflows.

Validator scripts under scripts/ and their test twins under tests/ are verification-layer code. When .github/CODEOWNERS exists, list each validator test twin explicitly rather than relying on name globs such as `tests/*evidence*`, which drift as files are added or renamed.

Accepted T003 export policy: the APKG generator may write synthetic feasibility exports to child directories under the resolved system temporary directory (`/tmp` in this environment). The temporary root itself is rejected. Child directories are allowed intentionally and do not need to be restricted to a dedicated per-run directory. Resolve paths before checking containment, as the current generator does.
