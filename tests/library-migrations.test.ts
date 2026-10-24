import { rm } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { migrateFixtureDatabase } from '../src/lib/server/db/migrate';
import {
  loadMigrations,
  readMigrationState
} from '../src/lib/server/db/remote-migrate';
import {
  createDisposableFixture,
  disposeDisposableFixture
} from './fixtures/database';
import { prefixThrough } from './fixtures/migration-prefix';

it('creates the Library indexes on upgrade and preserves their definitions on rerun', async () => {
  const target = await createDisposableFixture();
  const previous = await prefixThrough('0036_deck_language');
  let opened: Awaited<ReturnType<typeof openFixtureDatabase>> | undefined;
  try {
    await migrateFixtureDatabase(target, previous);
    opened = await openFixtureDatabase(target);
    const { client } = opened;
    const objectsSql =
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE tbl_name IN ('library_documents', 'library_ai_usage') AND type IN ('index', 'trigger') ORDER BY name";
    expect((await client.execute(objectsSql)).rows).toEqual([]);
    const state = await readMigrationState(
      client,
      loadMigrations(),
      'fixture.local'
    );
    expect(state.pending.map((migration) => migration.tag)).toEqual([
      '0037_light_drax',
      '0038_demonic_garia'
    ]);

    await migrateFixtureDatabase(target);
    const objects = (await client.execute(objectsSql)).rows;
    expect(
      objects.map(({ type, name, tbl_name }) => ({ type, name, tbl_name }))
    ).toEqual([
      {
        type: 'index',
        name: 'library_documents_owner_created',
        tbl_name: 'library_documents'
      },
      {
        type: 'index',
        name: 'sqlite_autoindex_library_ai_usage_1',
        tbl_name: 'library_ai_usage'
      },
      {
        type: 'index',
        name: 'sqlite_autoindex_library_documents_1',
        tbl_name: 'library_documents'
      }
    ]);
    for (const index of [
      {
        name: 'library_documents_owner_created',
        table: 'library_documents',
        columns: ['owner_id', 'created_at'],
        unique: 0
      },
      {
        name: 'sqlite_autoindex_library_documents_1',
        table: 'library_documents',
        columns: ['id'],
        unique: 1
      },
      {
        name: 'sqlite_autoindex_library_ai_usage_1',
        table: 'library_ai_usage',
        columns: ['day', 'owner_id'],
        unique: 1
      }
    ]) {
      const info = await client.execute(`PRAGMA index_info("${index.name}")`);
      expect(info.rows.map((column) => column.name)).toEqual(index.columns);
      const list = await client.execute(`PRAGMA index_list("${index.table}")`);
      expect(list.rows.find((row) => row.name === index.name)).toMatchObject({
        unique: index.unique
      });
    }

    await migrateFixtureDatabase(target);
    expect((await client.execute(objectsSql)).rows).toEqual(objects);
  } finally {
    opened?.close();
    await disposeDisposableFixture(target);
    await rm(previous, { recursive: true, force: true });
  }
});
