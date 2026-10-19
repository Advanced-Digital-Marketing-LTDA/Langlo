# Content import script

Date: 2026-10-19. Base: `main` `7a537a8`. Owner approved this bounded change in the project thread. No production database, remote database, provider call, credential or deployment was used; every database in the tests is a disposable local fixture.

## Behavior and scope

- `npm run content:import` builds one importer package from the approved bundle plus every `content/<track>/module-NN.json` (124 skills, 124 lessons, 1860 questions) and imports it through the existing `importContent`. Default is a dry run that also runs the importer's own `validatePackage`; `--apply --confirm-host HOST` writes.
- `--apply` refuses a database with no migration ledger or any pending migration, a `DATABASE_URL` that is not a `file:` URL or a bare `libsql://<name>.turso.io` URL, and a host that does not match `--confirm-host`. Only the script's own fixed messages are printed, never the URL, token or driver errors.
- A production-marked host is deliberately not refused, unlike the remote-test migrator: applying to production is an owner action (`docs/content-import.md`).
- Existing code touched: `isBareRemoteUrl` (`remote-migrate.ts`) and `validatePackage` (`content-import.ts`) are now exported; no logic change. `package.json` gains the `content:import` script line only.
- Files: `scripts/content-import.ts`, `src/lib/server/content-modules.ts`, `tests/content-import-script.test.ts`, `docs/content-import.md`.

## Observed green and red

Green, run on Node 22.22.0 (not the pinned 24.19), only the new and the importer's own files:

```text
vitest run tests/content-import-script.test.ts   Tests 14 passed (14)
vitest run tests/content-import.test.ts          Tests 60 passed (60)
```

`npm run check`-equivalent (`svelte-check`) 0 errors; eslint and prettier clean on the changed files. The full suite was not run locally; CI runs it.

The tests were written after the implementation, so red output comes from removing each guard and watching the matching test fail, then restoring it:

- pending-migration check removed: `refuses a database whose migrations are not applied` failed (1 failed, 5 passed at that time);
- module approval check removed: `rejects a module that is not approved` failed;
- host lowercase normalization removed: `accepts a bare Turso URL and connects to its normalized form` failed;
- `validatePackage` call removed from the dry run: `dry run fails on a package the importer would refuse` failed (1 failed, 13 passed).

## Pending acceptance

- Not run against a real Turso database or production. Production still lacks migrations 0013 to 0015, which must be applied before `--apply` there.
- A database that already holds the bundle alone under curriculum version `1.0.0` rejects the combined package (same version, different content), as `tests/fr-a1-module-01.test.ts` shows for the importer. Resolving it needs a curriculum version decision by the owner.
- `tsx` runs the script and is only a transitive dependency of `drizzle-kit`; declaring it is the owner's call.
- Full suite, browser tests and CI results are not claimed here.
