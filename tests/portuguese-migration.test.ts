import { afterEach, describe, expect, it } from 'vitest';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@libsql/client';
import {
  openFixtureDatabase,
  type FixtureTarget
} from '../src/lib/server/db/connection';
import { migrateFixtureDatabase } from '../src/lib/server/db/migrate';
import {
  applyRemoteTestPlan,
  loadMigrations,
  readMigrationState
} from '../src/lib/server/db/remote-migrate';
import {
  createDisposableFixture,
  disposeDisposableFixture
} from './fixtures/database';
import { seedStudy } from './fixtures/study';

// Migration 0026 widens skills and enrollments to Portuguese (Brazil) B1/B2
// by rebuilding both tables. Rows, dependants and guards must survive.

const fixtures: FixtureTarget[] = [];
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map((target) => disposeDisposableFixture(target))
  );
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true }))
  );
});

async function portugueseMigrationPrefix(inclusive = false) {
  const directory = await mkdtemp(join(tmpdir(), 'langlo-migrations-'));
  folders.push(directory);
  const journal = JSON.parse(
    await readFile('drizzle/meta/_journal.json', 'utf8')
  );
  const index = journal.entries.findIndex(
    (entry: { tag: string }) => entry.tag === '0026_portuguese_tracks'
  );
  if (index < 0) throw new Error('migration 0026 is missing');
  journal.entries = journal.entries.slice(0, index + (inclusive ? 1 : 0));
  await mkdir(join(directory, 'meta'));
  await writeFile(
    join(directory, 'meta/_journal.json'),
    JSON.stringify(journal)
  );
  for (const entry of journal.entries)
    await copyFile(
      `drizzle/${entry.tag}.sql`,
      join(directory, `${entry.tag}.sql`)
    );
  return directory;
}

async function upgraded() {
  const target = await createDisposableFixture();
  fixtures.push(target);
  await migrateFixtureDatabase(target, await portugueseMigrationPrefix());
  await seedStudy(target);
  const opened = await openFixtureDatabase(target);
  // Dependants that reference skills(id, language) and that seedStudy does not cover.
  await opened.client.batch(
    [
      "INSERT INTO skills (id, language, level) VALUES ('fr-nouns', 'fr', 'A1')",
      "INSERT INTO prerequisites (skill_id, prerequisite_id, language) VALUES ('fr-nouns', 'fr-articles', 'fr')",
      `INSERT INTO card_drafts (id, owner_id, language, skill_id, canonical_mistake, source_id, format, fields_json) VALUES ('draft-a', 'learner-a', 'fr', 'fr-articles', 'un maison', 'langlo:v1:${'a'.repeat(64)}', 'cloze', '{}')`
    ],
    'write'
  );
  const rows = async (client: Client) =>
    Promise.all(
      [
        'SELECT * FROM skills ORDER BY id',
        'SELECT * FROM enrollments ORDER BY id',
        'SELECT * FROM questions ORDER BY id',
        'SELECT * FROM content_versions ORDER BY id',
        'SELECT * FROM study_sessions ORDER BY id',
        'SELECT * FROM attempts ORDER BY id',
        'SELECT * FROM prerequisites ORDER BY skill_id, prerequisite_id',
        'SELECT * FROM card_drafts ORDER BY id'
      ].map(async (sql) =>
        (await client.execute(sql)).rows.map((r) => ({ ...r }))
      )
    );
  const before = await rows(opened.client);
  await migrateFixtureDatabase(target, await portugueseMigrationPrefix(true));
  return { ...opened, before, after: await rows(opened.client), rows };
}

async function rejects(client: Client, sql: string, message: RegExp) {
  await expect(client.execute(sql)).rejects.toThrow(message);
}

describe('migration 0026 Portuguese tracks', () => {
  it('keeps every skill, enrollment and dependant row and leaves no dangling reference', async () => {
    const { client, close, before, after } = await upgraded();
    try {
      expect(before[0].length).toBeGreaterThan(0);
      expect(before[1].length).toBeGreaterThan(0);
      expect(before[6].length).toBeGreaterThan(0);
      expect(before[7].length).toBeGreaterThan(0);
      expect(after).toEqual(before);
      expect((await client.execute('PRAGMA foreign_key_check')).rows).toEqual(
        []
      );
    } finally {
      close();
    }
  });

  it('accepts Portuguese B1 and B2 skills and enrollments with English explanations', async () => {
    const { client, close } = await upgraded();
    try {
      await client.batch(
        [
          "INSERT INTO skills (id, language, level) VALUES ('pt-b1-001', 'pt', 'B1'), ('pt-b2-001', 'pt', 'B2')",
          "INSERT INTO users (id) VALUES ('learner-c')",
          "INSERT INTO enrollments (id, owner_id, language, starting_level, explanation_language) VALUES ('enrollment-c1', 'learner-c', 'pt', 'B1', 'en')"
        ],
        'write'
      );
      await client.execute(
        "UPDATE enrollments SET starting_level = 'B2' WHERE id = 'enrollment-c1'"
      );
      expect(
        (
          await client.execute(
            "SELECT starting_level FROM enrollments WHERE id = 'enrollment-c1'"
          )
        ).rows[0].starting_level
      ).toBe('B2');
    } finally {
      close();
    }
  });

  it('still refuses every unsupported language and level pairing', async () => {
    const { client, close } = await upgraded();
    try {
      const enroll = (language: string, level: string, explanation = 'en') =>
        `INSERT INTO enrollments (id, owner_id, language, starting_level, explanation_language) VALUES ('x-${language}-${level}', 'learner-b', '${language}', '${level}', '${explanation}')`;
      for (const [language, level] of [
        ['pt', 'A1'],
        ['pt', 'A2'],
        ['fr', 'A2'],
        ['fr', 'B1'],
        ['de', 'B1'],
        ['en', 'B2']
      ])
        await rejects(client, enroll(language, level), /supported track/u);
      await rejects(
        client,
        enroll('es', 'A1'),
        /CHECK constraint failed|constraint/iu
      );
      await rejects(
        client,
        "INSERT INTO skills (id, language, level) VALUES ('x', 'es', 'A1')",
        /constraint/iu
      );
      await rejects(
        client,
        "INSERT INTO skills (id, language, level) VALUES ('x', 'pt', 'C1')",
        /constraint/iu
      );
    } finally {
      close();
    }
  });

  it('refuses Portuguese explanations on the Portuguese track, on insert and update', async () => {
    const { client, close } = await upgraded();
    try {
      await rejects(
        client,
        "INSERT INTO enrollments (id, owner_id, language, starting_level, explanation_language) VALUES ('x', 'learner-b', 'pt', 'B1', 'pt')",
        /explained in English/u
      );
      await client.execute(
        "INSERT INTO enrollments (id, owner_id, language, starting_level, explanation_language) VALUES ('y', 'learner-b', 'pt', 'B1', 'en')"
      );
      await rejects(
        client,
        "UPDATE enrollments SET explanation_language = 'pt' WHERE id = 'y'",
        /explained in English/u
      );
      await rejects(
        client,
        "UPDATE enrollments SET language = 'fr', starting_level = 'B1' WHERE id = 'y'",
        /supported track/u
      );
    } finally {
      close();
    }
  });

  it('keeps the skill identity guards and indexes the rebuild would otherwise drop', async () => {
    const { client, close } = await upgraded();
    try {
      await rejects(
        client,
        "INSERT INTO skills (id, language, level) VALUES ('  ', 'pt', 'B1')",
        /nonblank and NUL-free/u
      );
      await rejects(
        client,
        "UPDATE skills SET id = ' ' WHERE id = 'fr-articles'",
        /nonblank and NUL-free/u
      );
      await rejects(
        client,
        "INSERT INTO enrollments (id, owner_id, language, starting_level, explanation_language) VALUES ('dup', 'learner-a', 'fr', 'A1', 'en')",
        /UNIQUE/iu
      );
      const objects = (
        await client.execute(
          "SELECT name FROM sqlite_master WHERE name IN ('skills_identity_language', 'enrollments_owner_language_unique', 'enrollments_identity_owner_language', 'skills_review_identity_insert', 'skills_review_identity_update', 'enrollments_supported_track_insert', 'enrollments_supported_track_update') ORDER BY name"
        )
      ).rows.map((row) => row.name);
      expect(objects).toHaveLength(7);
    } finally {
      close();
    }
  });

  it('rolls the whole rebuild back when any later statement fails', async () => {
    const target = await createDisposableFixture();
    fixtures.push(target);
    await migrateFixtureDatabase(target, await portugueseMigrationPrefix());
    await seedStudy(target);
    const { client, close } = await openFixtureDatabase(target);
    try {
      const sqlBefore = (
        await client.execute(
          "SELECT name, sql FROM sqlite_master WHERE name IN ('skills', 'enrollments') ORDER BY name"
        )
      ).rows.map((r) => ({ ...r }));
      const statements = (
        await readFile('drizzle/0026_portuguese_tracks.sql', 'utf8')
      )
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean);
      // Same all-or-nothing path the deploy uses; the last statement overflows on purpose.
      await expect(
        client.migrate([...statements, 'SELECT abs(-9223372036854775808)'])
      ).rejects.toThrow(/integer overflow/);
      const sqlAfter = (
        await client.execute(
          "SELECT name, sql FROM sqlite_master WHERE name IN ('skills', 'enrollments') ORDER BY name"
        )
      ).rows.map((r) => ({ ...r }));
      expect(sqlAfter).toEqual(sqlBefore);
      const scratch = await client.execute(
        "SELECT name FROM sqlite_master WHERE name LIKE '__new_%' UNION ALL SELECT name FROM sqlite_temp_master WHERE name LIKE 'langlo_portuguese%'"
      );
      expect(scratch.rows).toEqual([]);
      await rejects(
        client,
        "INSERT INTO skills (id, language, level) VALUES ('pt-b1-001', 'pt', 'B1')",
        /CHECK constraint failed/
      );
      expect(
        (await client.execute('SELECT count(*) AS n FROM skills')).rows[0].n
      ).toBe(1);
      expect(
        (await client.execute('SELECT count(*) AS n FROM enrollments')).rows[0]
          .n
      ).toBe(2);
    } finally {
      close();
    }
  });

  it('refuses to run with foreign keys enforced instead of cascading study history away', async () => {
    const target = await createDisposableFixture();
    fixtures.push(target);
    await migrateFixtureDatabase(target, await portugueseMigrationPrefix());
    await seedStudy(target);
    const { client, close } = await openFixtureDatabase(target);
    try {
      expect(
        (await client.execute('PRAGMA foreign_keys')).rows[0].foreign_keys
      ).toBe(1);
      const statements = (
        await readFile('drizzle/0026_portuguese_tracks.sql', 'utf8')
      )
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean);
      // A plain batch keeps foreign_keys on, unlike the libSQL migrate path.
      await expect(client.batch(statements, 'write')).rejects.toThrow(
        /foreign_keys_must_be_off/
      );
      for (const [table, count] of [
        ['study_sessions', 2],
        ['attempts', 1],
        ['evaluations', 1],
        ['enrollments', 2],
        ['skills', 1]
      ] as const)
        expect(
          (await client.execute(`SELECT count(*) AS n FROM ${table}`)).rows[0].n
        ).toBe(count);
    } finally {
      close();
    }
  });

  it('upgrades a populated database through the remote apply path without losing study history', async () => {
    const target = await createDisposableFixture();
    fixtures.push(target);
    await migrateFixtureDatabase(target, await portugueseMigrationPrefix());
    await seedStudy(target);
    const { client, close } = await openFixtureDatabase(target);
    try {
      const counts = async () =>
        Promise.all(
          [
            'skills',
            'enrollments',
            'study_sessions',
            'attempts',
            'evaluations'
          ].map(
            async (table) =>
              (await client.execute(`SELECT count(*) AS n FROM ${table}`))
                .rows[0].n
          )
        );
      const before = await counts();
      const migrations = loadMigrations();
      const host = 'remote.example.test';
      const state = await readMigrationState(client, migrations, host);
      expect(state.pending.map((m) => m.tag)).toEqual([
        '0026_portuguese_tracks',
        '0027_peaceful_albert_cleary',
        '0028_sturdy_talkback',
        '0029_current_grammar_content',
        '0030_portuguese_grammar_retention',
        '0031_retention_reset_on_meaning_change',
        '0032_retention_transfers_to_new_versions'
      ]);
      const result = await applyRemoteTestPlan(client, migrations, {
        host,
        confirmHost: host,
        planId: state.planId
      });
      expect(result.applied).toEqual(
        state.pending.map((migration) => migration.tag)
      );
      expect(await counts()).toEqual(before);
      expect(before.every((n) => Number(n) > 0)).toBe(true);
      await client.execute(
        "INSERT INTO skills (id, language, level) VALUES ('pt-b1-001', 'pt', 'B1')"
      );
    } finally {
      close();
    }
  });

  it('leaves no scratch tables behind', async () => {
    const { client, close } = await upgraded();
    try {
      const temp = await client.execute(
        "SELECT name FROM sqlite_temp_master WHERE name LIKE 'langlo_portuguese%'"
      );
      expect(temp.rows).toEqual([]);
      const main = await client.execute(
        "SELECT name FROM sqlite_master WHERE name LIKE '__new_%'"
      );
      expect(main.rows).toEqual([]);
    } finally {
      close();
    }
  });
});
