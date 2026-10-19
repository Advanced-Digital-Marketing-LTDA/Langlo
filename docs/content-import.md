# Content import

`npm run content:import` loads the approved curriculum bundle and every authored module (`content/<track>/module-NN.json`) into the shared content tables (skills, prerequisites, lessons, questions) through the checked importer in `src/lib/server/content-import.ts`. It touches no learner table.

- **Dry run (default):** `npm run content:import` builds and validates the package and prints its counts. It writes nothing and needs no database.
- **Apply:** `DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run content:import -- --apply --confirm-host HOST`. `DATABASE_URL` is a `file:` URL (HOST is `local`) or a bare `libsql://<name>.turso.io` URL (HOST is that host name). The script refuses a database with any migration still pending, so a target must have every checked-in migration applied first.
- **Repeatable:** the importer is idempotent. Re-running the same package is a no-op; a changed package needs a new curriculum version.
- **Runner:** the script runs through `tsx` (already installed as a dependency of `drizzle-kit` and `vite`) because the importer uses extensionless imports that plain Node cannot resolve.

Applying to a production database is an owner action.
