import { afterEach, describe, expect, it } from 'vitest';
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  copyFile,
  rm
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openFixtureDatabase,
  type FixtureTarget
} from '../src/lib/server/db/connection';
import { migrateFixtureDatabase } from '../src/lib/server/db/migrate';
import { isTable } from 'drizzle-orm';
import {
  loadMigrations,
  readMigrationState
} from '../src/lib/server/db/remote-migrate';
import {
  createDisposableFixture,
  disposeDisposableFixture
} from './fixtures/database';
import { seedStudy } from './fixtures/study';
import { prefixThrough } from './fixtures/migration-prefix';
import { seedLegacyPackage } from './fixtures/content-package';
import { importContent } from '../src/lib/server/content-import';
import * as schema from '../src/lib/server/db/schema';
import { createDeck } from '../src/lib/server/flashcards';

const fixtures: FixtureTarget[] = [];
afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map((target) => disposeDisposableFixture(target))
  );
});

/** Allocate a tracked disposable target so clean and historical-upgrade tests can choose their migration prefix. */
async function fixture() {
  const target = await createDisposableFixture();
  fixtures.push(target);
  return target;
}

async function migrationPrefixBeforeLanglo10() {
  const directory = await mkdtemp(join(tmpdir(), 'langlo-migrations-'));
  const journal = JSON.parse(
    await readFile('drizzle/meta/_journal.json', 'utf8')
  );
  const migrationIndex = journal.entries.findIndex(
    (entry: { tag: string }) => entry.tag === '0023_solid_dazzler'
  );
  if (migrationIndex < 0) throw new Error('LANGLO-10 migration is missing');
  journal.entries = journal.entries.slice(0, migrationIndex);
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

async function createLegacyNote(
  client: Parameters<typeof createDeck>[0],
  owner: Parameters<typeof createDeck>[1],
  input: {
    id: string;
    sourceId: string;
    deckId: string;
    kind: 'basic';
    content: { front: string; back: string };
  }
) {
  await client.execute({
    sql: "INSERT INTO native_flashcard_notes (id, source_id, owner_id, deck_id, kind, content_json, status) VALUES (?, ?, ?, ?, ?, ?, 'draft')",
    args: [
      input.id,
      input.sourceId,
      owner.userId,
      input.deckId,
      input.kind,
      JSON.stringify(input.content)
    ]
  });
  return { id: input.id, cardId: `card:${input.id}`, status: 'draft' as const };
}

async function seedLegacyReviewHistory(
  target: FixtureTarget,
  previous: string
) {
  await migrateFixtureDatabase(target, previous);
  await seedStudy(target);
  const { client, close } = await openFixtureDatabase(target);
  try {
    const owner = { userId: 'learner-a' };
    await createDeck(client, owner, {
      id: 'deck-langlo10',
      name: 'French'
    });
    const notes = await Promise.all(
      ['draft', 'rejected', 'rejected-reviewed', 'approved-reviewed'].map(
        (id, index) =>
          createLegacyNote(client, owner, {
            id: `note-langlo10-${id}`,
            sourceId: `langlo:v1:${String(index + 1).repeat(64)}`,
            deckId: 'deck-langlo10',
            kind: 'basic',
            content: { front: `front ${id}`, back: `back ${id}` }
          })
      )
    );
    await client.execute({
      sql: "UPDATE native_flashcard_notes SET status = 'rejected' WHERE id IN (?, ?)",
      args: [notes[1].id, notes[2].id]
    });
    await client.execute({
      sql: "UPDATE native_flashcard_notes SET status = 'approved' WHERE id = ?",
      args: [notes[3].id]
    });
    for (const note of notes)
      await client.execute({
        sql: 'INSERT INTO native_flashcards (id, owner_id, note_id, ordinal, state_json, due_at, revision, suspended, scheduler_version, parameters_json) VALUES (?, ?, ?, 0, ?, 0, 0, 0, ?, ?)',
        args: [note.cardId, owner.userId, note.id, '{}', 'legacy-v1', '{}']
      });
    for (const [index, note] of [notes[2], notes[3]].entries())
      await client.execute({
        sql: 'INSERT INTO native_flashcard_review_events (id, owner_id, card_id, expected_revision, rating, reviewed_at, scheduler_version, parameters_json, result_json) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)',
        args: [
          `legacy-review-${index}`,
          owner.userId,
          note.cardId,
          'good',
          index,
          'legacy-v1',
          '{}',
          '{}'
        ]
      });
  } finally {
    close();
  }
}

async function expectMigratedReviewHistory(
  client: Awaited<ReturnType<typeof openFixtureDatabase>>['client']
) {
  expect(
    (await client.execute('SELECT id FROM native_flashcard_notes ORDER BY id'))
      .rows
  ).toHaveLength(4);
  expect(
    (
      await client.execute(
        'SELECT note_id FROM native_flashcards ORDER BY note_id'
      )
    ).rows
  ).toEqual([
    { note_id: 'note-langlo10-approved-reviewed' },
    { note_id: 'note-langlo10-rejected-reviewed' }
  ]);
  expect(
    (
      await client.execute(
        'SELECT id, state_json FROM native_flashcard_review_events ORDER BY id'
      )
    ).rows
  ).toEqual([
    { id: 'legacy-review-0', state_json: null },
    { id: 'legacy-review-1', state_json: null }
  ]);
  const reviewTable = await client.execute(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'native_flashcard_review_events'"
  );
  expect(String(reviewTable.rows[0].sql)).toMatch(/WITHOUT ROWID/iu);
  expect(
    (
      await client.execute(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN ('native_flashcard_review_events_no_delete', 'native_flashcard_review_events_no_replace', 'native_flashcard_review_events_no_update') ORDER BY name"
      )
    ).rows.map((row) => row.name)
  ).toEqual([
    'native_flashcard_review_events_no_delete',
    'native_flashcard_review_events_no_replace',
    'native_flashcard_review_events_no_update'
  ]);
  expect((await client.execute('PRAGMA foreign_key_check')).rows).toEqual([]);
}

async function seedDraftWithReviewHistory(
  target: FixtureTarget,
  previous: string
) {
  await migrateFixtureDatabase(target, previous);
  await seedStudy(target);
  const { client, close } = await openFixtureDatabase(target);
  try {
    const owner = { userId: 'learner-a' };
    await createDeck(client, owner, {
      id: 'deck-langlo10-gate',
      name: 'French'
    });
    const note = await createLegacyNote(client, owner, {
      id: 'note-langlo10-draft-history',
      sourceId: `langlo:v1:${'a'.repeat(64)}`,
      deckId: 'deck-langlo10-gate',
      kind: 'basic',
      content: { front: 'front', back: 'back' }
    });
    await client.execute({
      sql: 'INSERT INTO native_flashcards (id, owner_id, note_id, ordinal, state_json, due_at, revision, suspended, scheduler_version, parameters_json) VALUES (?, ?, ?, 0, ?, 0, 0, 0, ?, ?)',
      args: [note.cardId, owner.userId, note.id, '{}', 'legacy-v1', '{}']
    });
    await client.execute({
      sql: 'INSERT INTO native_flashcard_review_events (id, owner_id, card_id, expected_revision, rating, reviewed_at, scheduler_version, parameters_json, result_json) VALUES (?, ?, ?, 0, ?, 0, ?, ?, ?)',
      args: [
        'draft-review',
        owner.userId,
        note.cardId,
        'good',
        'legacy-v1',
        '{}',
        '{}'
      ]
    });
  } finally {
    close();
  }
}

async function expectFailedDraftReviewMigration(target: FixtureTarget) {
  await expect(migrateFixtureDatabase(target)).rejects.toThrow();
  const { client, close } = await openFixtureDatabase(target);
  try {
    expect(
      (
        await client.execute(
          'PRAGMA table_info(native_flashcard_review_events)'
        )
      ).rows.map((row) => row.name)
    ).not.toContain('state_json');
    expect(
      (
        await client.execute('SELECT id FROM native_flashcards WHERE id = ?', [
          'card:note-langlo10-draft-history'
        ])
      ).rows
    ).toHaveLength(1);
    expect(
      (
        await client.execute(
          'SELECT id FROM native_flashcard_review_events WHERE id = ?',
          ['draft-review']
        )
      ).rows
    ).toHaveLength(1);
  } finally {
    close();
  }
}

describe('disposable libSQL migrations', () => {
  it('accepts the production migration ledger through Portuguese 0026 as an unchanged prefix', async () => {
    const target = await fixture();
    const folder = await prefixThrough('0026_portuguese_tracks');
    try {
      await migrateFixtureDatabase(target, folder);
      await seedStudy(target);
      const { client, close } = await openFixtureDatabase(target);
      try {
        const migrations = loadMigrations();
        expect(migrations[26]).toMatchObject({
          tag: '0026_portuguese_tracks',
          when: 1792536374088,
          hash: '2295986c1ea163749769e062ad8d617e61599a592d536d294af10057317dada3'
        });
        const ledger = (
          await client.execute(
            'SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at'
          )
        ).rows;
        const state = await readMigrationState(
          client,
          migrations,
          'fixture.local'
        );
        expect(state.applied).toHaveLength(27);
        expect(state.pending.map((m) => m.tag)).toEqual([
          '0027_peaceful_albert_cleary',
          '0028_sturdy_talkback',
          '0029_current_grammar_content',
          '0030_portuguese_grammar_retention',
          '0031_retention_transfers_to_new_versions'
        ]);
        await migrateFixtureDatabase(target);
        expect(
          (
            await client.execute(
              'SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at'
            )
          ).rows.slice(0, 27)
        ).toEqual(ledger);
        expect(
          (await readMigrationState(client, migrations, 'fixture.local'))
            .pending
        ).toHaveLength(0);
      } finally {
        close();
      }
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  async function beforePortugueseRetention() {
    const target = await fixture();
    const folder = await prefixThrough('0029_current_grammar_content');
    try {
      await migrateFixtureDatabase(target, folder);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
    await seedStudy(target);
    const opened = await openFixtureDatabase(target);
    await opened.client.batch(
      [
        "INSERT INTO grammar_retention_schedules (owner_id, language, skill_id, content_version_id, state_json, due_at, revision, scheduler_version, parameters_json) VALUES ('learner-a', 'fr', 'fr-articles', 'content-v1', '{}', 123456, 1, 'fixture', '{}')",
        "INSERT INTO grammar_retention_events (id, owner_id, study_session_id, language, skill_id, attempt_id, evaluation_id, content_version_id, lineage_key, expected_revision, rating, reviewed_at, scheduler_version, parameters_json, result_json, state_json) VALUES ('review-a', 'learner-a', 'study-a', 'fr', 'fr-articles', 'attempt-a', 'evaluation-a', 'content-v1', 'item-a', 0, 'again', 1, 'fixture', '{}', '{}', '{}')"
      ],
      'write'
    );
    return { ...opened, target };
  }

  it('preserves schedules, history and immutability guards through the Portuguese retention rebuild', async () => {
    const { client, close, target } = await beforePortugueseRetention();
    try {
      const schedules = (
        await client.execute('SELECT * FROM grammar_retention_schedules')
      ).rows;
      const events = (
        await client.execute('SELECT * FROM grammar_retention_events')
      ).rows;
      await migrateFixtureDatabase(target);
      await migrateFixtureDatabase(target);
      expect(
        (await client.execute('SELECT * FROM grammar_retention_schedules')).rows
      ).toEqual(schedules);
      expect(
        (await client.execute('SELECT * FROM grammar_retention_events')).rows
      ).toEqual(events);
      expect((await client.execute('PRAGMA foreign_key_check')).rows).toEqual(
        []
      );
      await expect(
        client.execute("UPDATE grammar_retention_events SET rating = 'easy'")
      ).rejects.toThrow(/cannot be updated/);
      await expect(
        client.execute('DELETE FROM grammar_retention_events')
      ).rejects.toThrow(/cannot be deleted/);
      await client.execute(
        "UPDATE content_versions SET status = 'pilot-ready' WHERE id = 'content-v2'"
      );
      expect(
        (
          await client.execute(
            'SELECT content_version_id, reset_required FROM grammar_retention_schedules'
          )
        ).rows
      ).toEqual([{ content_version_id: 'content-v2', reset_required: 0 }]);
      await client.execute("DELETE FROM users WHERE id = 'learner-a'");
      expect(
        (await client.execute('SELECT * FROM grammar_retention_schedules')).rows
      ).toEqual([]);
      expect(
        (await client.execute('SELECT * FROM grammar_retention_events')).rows
      ).toEqual([]);
    } finally {
      close();
    }
  });

  it('refuses the Portuguese retention rebuild when a caller keeps foreign keys enabled', async () => {
    const { client, close } = await beforePortugueseRetention();
    try {
      const schedules = (
        await client.execute('SELECT * FROM grammar_retention_schedules')
      ).rows;
      const events = (
        await client.execute('SELECT * FROM grammar_retention_events')
      ).rows;
      const migration = loadMigrations().find(
        (m) => m.tag === '0030_portuguese_grammar_retention'
      );
      if (!migration) throw new Error('Missing Portuguese retention migration');
      await expect(client.batch(migration.statements, 'write')).rejects.toThrow(
        /must_be_off/
      );
      expect(
        (await client.execute('SELECT * FROM grammar_retention_schedules')).rows
      ).toEqual(schedules);
      expect(
        (await client.execute('SELECT * FROM grammar_retention_events')).rows
      ).toEqual(events);
    } finally {
      close();
    }
  });

  it('rolls back the Portuguese retention rebuild on a late failure', async () => {
    const { client, close } = await beforePortugueseRetention();
    try {
      const schedules = (
        await client.execute('SELECT * FROM grammar_retention_schedules')
      ).rows;
      const events = (
        await client.execute('SELECT * FROM grammar_retention_events')
      ).rows;
      const before = (
        await client.execute(
          "SELECT name, sql FROM sqlite_master WHERE name LIKE 'grammar_retention_%' ORDER BY name"
        )
      ).rows;
      const migration = loadMigrations().find(
        (m) => m.tag === '0030_portuguese_grammar_retention'
      );
      if (!migration) throw new Error('Missing Portuguese retention migration');
      await expect(
        client.migrate([
          ...migration.statements,
          'SELECT * FROM synthetic_missing_table'
        ])
      ).rejects.toThrow();
      expect(
        (await client.execute('SELECT * FROM grammar_retention_schedules')).rows
      ).toEqual(schedules);
      expect(
        (await client.execute('SELECT * FROM grammar_retention_events')).rows
      ).toEqual(events);
      expect(
        (
          await client.execute(
            "SELECT name, sql FROM sqlite_master WHERE name LIKE 'grammar_retention_%' ORDER BY name"
          )
        ).rows
      ).toEqual(before);
      expect((await client.execute('PRAGMA foreign_key_check')).rows).toEqual(
        []
      );
    } finally {
      close();
    }
  });

  async function migrateBeforeGrammarResetFix(
    target: FixtureTarget,
    previous: string
  ) {
    const journal = JSON.parse(
      await readFile('drizzle/meta/_journal.json', 'utf8')
    );
    const index = journal.entries.findIndex(
      (entry: { tag: string }) => entry.tag === '0029_current_grammar_content'
    );
    expect(index).toBeGreaterThan(0);
    journal.entries = journal.entries.slice(0, index);
    await mkdir(join(previous, 'meta'));
    await writeFile(
      join(previous, 'meta/_journal.json'),
      JSON.stringify(journal)
    );
    for (const entry of journal.entries)
      await copyFile(
        `drizzle/${entry.tag}.sql`,
        join(previous, `${entry.tag}.sql`)
      );
    await migrateFixtureDatabase(target, previous);
  }

  it('upgrades grammar retention triggers without changing stored schedules and only moves schedules to the newest published content', async () => {
    const target = await fixture();
    const previous = await mkdtemp(join(tmpdir(), 'langlo-0029-upgrade-'));
    try {
      await migrateBeforeGrammarResetFix(target, previous);
      await seedStudy(target);
      const { client, close } = await openFixtureDatabase(target);
      try {
        await client.execute(
          "INSERT INTO grammar_retention_schedules (owner_id, language, skill_id, content_version_id, state_json, due_at, revision, scheduler_version, parameters_json) VALUES ('learner-a', 'fr', 'fr-articles', 'content-v1', '{}', 123456, 3, 'fixture', '{}')"
        );
        const before = (
          await client.execute('SELECT * FROM grammar_retention_schedules')
        ).rows;
        await migrateFixtureDatabase(target);
        await migrateFixtureDatabase(target);
        expect(
          (await client.execute('SELECT * FROM grammar_retention_schedules'))
            .rows
        ).toEqual(before);
        await client.execute(
          "UPDATE content_versions SET status = 'pilot-ready' WHERE id = 'content-v2'"
        );
        expect(
          (
            await client.execute(
              'SELECT content_version_id, due_at, revision FROM grammar_retention_schedules'
            )
          ).rows
        ).toEqual([
          { content_version_id: 'content-v2', due_at: 123456, revision: 4 }
        ]);
        await client.execute(
          "INSERT INTO content_versions (id, skill_id, language, version, status) VALUES ('content-backfill', 'fr-articles', 'fr', 3, 'draft')"
        );
        await client.execute(
          "UPDATE content_versions SET status = 'quarantined' WHERE id = 'content-v1'"
        );
        await client.execute(
          "UPDATE content_versions SET status = 'pilot-ready' WHERE id = 'content-v1'"
        );
        expect(
          (
            await client.execute(
              'SELECT content_version_id, revision FROM grammar_retention_schedules'
            )
          ).rows
        ).toEqual([{ content_version_id: 'content-v2', revision: 4 }]);
      } finally {
        close();
      }
    } finally {
      await rm(previous, { recursive: true, force: true });
    }
  });

  it('preserves legacy data and adopts verified content after a pre-0007 upgrade', async () => {
    const target = await fixture();
    const previous = await mkdtemp(join(tmpdir(), 'langlo-migrations-'));
    try {
      const journal = JSON.parse(
        await readFile('drizzle/meta/_journal.json', 'utf8')
      );
      journal.entries = journal.entries.slice(0, 7);
      await mkdir(join(previous, 'meta'));
      await writeFile(
        join(previous, 'meta/_journal.json'),
        JSON.stringify(journal)
      );
      for (const entry of journal.entries)
        await copyFile(
          `drizzle/${entry.tag}.sql`,
          join(previous, `${entry.tag}.sql`)
        );
      await migrateFixtureDatabase(target, previous);
      await seedStudy(target);
      const { client, close } = await openFixtureDatabase(target);
      try {
        const pkg = await seedLegacyPackage(client);
        const contentSql =
          'SELECT id, skill_id, language, version, status, created_at FROM content_versions ORDER BY id';
        const objectsSql =
          "SELECT type, name, sql FROM sqlite_master WHERE type IN ('index', 'trigger') AND name NOT LIKE 'grammar_retention_%' AND name NOT IN ('sqlite_autoindex_lessons_1', 'sqlite_autoindex_grammar_retention_events_1', 'sqlite_autoindex_grammar_retention_schedules_1', 'attempts_session_question_independent', 'sqlite_autoindex_ai_usage_1', 'sqlite_autoindex_content_reports_1', 'content_reports_owner_submission', 'content_reports_owner_created', 'sqlite_autoindex_learner_preferences_1', 'sqlite_autoindex_content_changes_1', 'content_changes_skill', 'sqlite_autoindex_lesson_translations_1', 'sqlite_autoindex_native_flashcard_preferences_1', 'native_flashcard_notes_owner_source_attempt_unique', 'native_flashcard_notes_owner_cursor', 'native_flashcard_notes_source_shape_insert', 'native_flashcard_notes_source_shape_update', 'native_flashcard_notes_source_attempt_insert', 'native_flashcard_notes_source_attempt_update', 'enrollments_supported_track_insert', 'enrollments_supported_track_update', 'enrollments_portuguese_explanation_insert', 'enrollments_portuguese_explanation_update') ORDER BY name";
        const content = (await client.execute(contentSql)).rows;
        const attempts = (
          await client.execute(
            'SELECT id, owner_id, study_session_id, question_id, content_version_id, skill_id, language, submission_key, evidence_kind, answer, created_at FROM attempts'
          )
        ).rows;
        const objects = (await client.execute(objectsSql)).rows;
        await migrateFixtureDatabase(target);
        expect((await client.execute(contentSql)).rows).toEqual(content);
        expect(
          (
            await client.execute(
              'SELECT id, owner_id, study_session_id, question_id, content_version_id, skill_id, language, submission_key, evidence_kind, answer, created_at FROM attempts'
            )
          ).rows
        ).toEqual(attempts);
        expect(
          (await client.execute('SELECT DISTINCT holdout FROM questions')).rows
        ).toEqual([{ holdout: 0 }]);
        expect((await client.execute('PRAGMA foreign_key_check')).rows).toEqual(
          []
        );
        expect((await client.execute(objectsSql)).rows).toEqual(objects);
        expect(
          (
            await client.execute('SELECT fingerprint FROM content_versions')
          ).rows.map((row) => row.fingerprint)
        ).toEqual([null, null, null, null]);
        expect(await importContent(client, pkg)).toEqual({
          skills: 0,
          prerequisites: 0,
          versions: 0,
          questions: 0,
          quarantined: 0
        });
        expect((await client.execute(contentSql)).rows).toEqual(content);
        expect(
          (
            await client.execute(
              'SELECT id, owner_id, study_session_id, question_id, content_version_id, skill_id, language, submission_key, evidence_kind, answer, created_at FROM attempts'
            )
          ).rows
        ).toEqual(attempts);
        expect((await client.execute(objectsSql)).rows).toEqual(objects);
        expect(
          (
            await client.execute(
              "SELECT fingerprint FROM content_versions WHERE id LIKE 'fr-a1-%' ORDER BY id"
            )
          ).rows
        ).toEqual([
          { fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u) },
          { fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u) }
        ]);
        pkg.curriculumVersion = '0.2.0';
        const revised = pkg.versions[0];
        revised.id = 'fr-a1-001@2';
        revised.version = 2;
        revised.questions.forEach((question) => {
          question.id = question.id.replace('@1:', '@2:');
          question.change = 'new';
        });
        revised.questions[0].prompt = 'Tu ___ étudiant.';
        expect((await importContent(client, pkg)).versions).toBe(1);
        expect((await client.execute(contentSql)).rows).toEqual(
          expect.arrayContaining(content)
        );
        expect(
          (
            await client.execute(
              'SELECT id, owner_id, study_session_id, question_id, content_version_id, skill_id, language, submission_key, evidence_kind, answer, created_at FROM attempts'
            )
          ).rows
        ).toEqual(attempts);
        expect((await client.execute('PRAGMA foreign_key_check')).rows).toEqual(
          []
        );
        expect(
          (await client.execute('PRAGMA integrity_check')).rows[0]
            .integrity_check
        ).toBe('ok');
      } finally {
        close();
      }
    } finally {
      await rm(previous, { recursive: true, force: true });
    }
  });

  it('fails a hardening upgrade closed when the previous schema contains a text version', async () => {
    const target = await fixture();
    const previous = await mkdtemp(join(tmpdir(), 'langlo-migrations-'));
    try {
      const journal = JSON.parse(
        await readFile('drizzle/meta/_journal.json', 'utf8')
      );
      journal.entries = journal.entries.slice(0, 2);
      await mkdir(join(previous, 'meta'));
      await writeFile(
        join(previous, 'meta/_journal.json'),
        JSON.stringify(journal)
      );
      for (const entry of journal.entries) {
        await copyFile(
          `drizzle/${entry.tag}.sql`,
          join(previous, `${entry.tag}.sql`)
        );
      }
      await migrateFixtureDatabase(target, previous);
      await seedStudy(target);
      const old = await openFixtureDatabase(target);
      await old.client.execute(
        "UPDATE content_versions SET version='invalid-text' WHERE id='content-v1'"
      );
      const before = (
        await old.client.execute(
          'SELECT id, owner_id, study_session_id, question_id, content_version_id, skill_id, language, submission_key, evidence_kind, answer, created_at FROM attempts'
        )
      ).rows;
      old.close();
      await expect(migrateFixtureDatabase(target)).rejects.toThrow(
        /CHECK|CONSTRAINT/iu
      );
      const unchanged = await openFixtureDatabase(target);
      try {
        expect(
          (
            await unchanged.client.execute(
              'SELECT count(*) AS n FROM __drizzle_migrations'
            )
          ).rows[0].n
        ).toBe(2);
        expect(
          (
            await unchanged.client.execute(
              'SELECT id, owner_id, study_session_id, question_id, content_version_id, skill_id, language, submission_key, evidence_kind, answer, created_at FROM attempts'
            )
          ).rows
        ).toEqual(before);
        expect(
          (
            await unchanged.client.execute(
              "SELECT version FROM content_versions WHERE id='content-v1'"
            )
          ).rows[0].version
        ).toBe('invalid-text');
      } finally {
        unchanged.close();
      }
    } finally {
      await rm(previous, { recursive: true, force: true });
    }
  });
  it.each([
    "UPDATE enrollments SET starting_level='A2' WHERE id='enrollment-a'",
    'INSERT INTO users (id) VALUES (char(9))',
    "INSERT INTO skills (id, language, level) VALUES (char(160), 'fr', 'A1')",
    "INSERT INTO card_drafts (id, owner_id, language, skill_id, canonical_mistake, source_id, format, fields_json) VALUES ('invalid-card', 'learner-a', 'fr', 'fr-articles', char(9), 'langlo:v1:' || printf('%064d', 0), 'cloze', '{}')",
    "INSERT INTO card_drafts (id, owner_id, language, skill_id, canonical_mistake, source_id, format, fields_json) VALUES ('invalid-card', 'learner-a', 'fr', 'fr-articles', 'x' || char(0), 'langlo:v1:' || printf('%064d', 0), 'cloze', '{}')"
  ])(
    'fails the review upgrade closed without rewriting invalid history: %s',
    async (statement) => {
      const target = await fixture();
      const previous = await mkdtemp(join(tmpdir(), 'langlo-migrations-'));
      try {
        const journal = JSON.parse(
          await readFile('drizzle/meta/_journal.json', 'utf8')
        );
        journal.entries = journal.entries.slice(0, 3);
        await mkdir(join(previous, 'meta'));
        await writeFile(
          join(previous, 'meta/_journal.json'),
          JSON.stringify(journal)
        );
        for (const entry of journal.entries) {
          await copyFile(
            `drizzle/${entry.tag}.sql`,
            join(previous, `${entry.tag}.sql`)
          );
        }
        await migrateFixtureDatabase(target, previous);
        await seedStudy(target);
        const old = await openFixtureDatabase(target);
        await old.client.execute(statement);
        const before = (
          await old.client.execute(
            'SELECT id, owner_id, study_session_id, question_id, content_version_id, skill_id, language, submission_key, evidence_kind, answer, created_at FROM attempts'
          )
        ).rows;
        const enrollments = (
          await old.client.execute('SELECT * FROM enrollments')
        ).rows;
        const cards = (await old.client.execute('SELECT * FROM card_drafts'))
          .rows;
        old.close();
        await expect(migrateFixtureDatabase(target)).rejects.toThrow(
          /CHECK|CONSTRAINT/iu
        );
        const unchanged = await openFixtureDatabase(target);
        try {
          expect(
            (
              await unchanged.client.execute(
                'SELECT count(*) AS n FROM __drizzle_migrations'
              )
            ).rows[0].n
          ).toBe(3);
          expect(
            (
              await unchanged.client.execute(
                'SELECT id, owner_id, study_session_id, question_id, content_version_id, skill_id, language, submission_key, evidence_kind, answer, created_at FROM attempts'
              )
            ).rows
          ).toEqual(before);
          expect(
            (await unchanged.client.execute('SELECT * FROM enrollments')).rows
          ).toEqual(enrollments);
          expect(
            (await unchanged.client.execute('SELECT * FROM card_drafts')).rows
          ).toEqual(cards);
          expect(
            (
              await unchanged.client.execute(
                "SELECT name FROM sqlite_master WHERE name LIKE '%review_identity%' OR name LIKE '%supported_track%'"
              )
            ).rows
          ).toEqual([]);
        } finally {
          unchanged.close();
        }
      } finally {
        await rm(previous, { recursive: true, force: true });
      }
    }
  );
  it('creates authentic owner/versioned study and card tables on a clean database', async () => {
    const target = await fixture();
    await migrateFixtureDatabase(target);
    const { client, close } = await openFixtureDatabase(target);
    try {
      const result = await client.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
      );
      expect(result.rows.map((row) => row.name)).toEqual(
        expect.arrayContaining([
          'users',
          'enrollments',
          'skills',
          'prerequisites',
          'content_versions',
          'questions',
          'study_sessions',
          'attempts',
          'evaluations',
          'skill_evidence',
          'card_drafts',
          'deliveries'
        ])
      );
      expect(
        (await client.execute('PRAGMA foreign_keys')).rows[0].foreign_keys
      ).toBe(1);
    } finally {
      close();
    }
  });

  it('matches every Drizzle table export to the actual migrated columns', async () => {
    const target = await fixture();
    await migrateFixtureDatabase(target);
    const { db, close } = await openFixtureDatabase(target);
    try {
      for (const table of Object.values(schema)) {
        if (!isTable(table)) continue;
        expect(await db.select().from(table)).toEqual([]);
      }
    } finally {
      close();
    }
  });

  it('repeating all migrations preserves existing rows and records each migration once', async () => {
    const target = await fixture();
    await migrateFixtureDatabase(target);
    await seedStudy(target);
    await migrateFixtureDatabase(target);
    const { client, close } = await openFixtureDatabase(target);
    try {
      expect(
        (
          await client.execute(
            'SELECT owner_id, content_version_id, evidence_kind FROM attempts'
          )
        ).rows
      ).toEqual([
        {
          owner_id: 'learner-a',
          content_version_id: 'content-v1',
          evidence_kind: 'independent'
        }
      ]);
      expect(
        (
          await client.execute(
            'SELECT count(*) AS count FROM __drizzle_migrations'
          )
        ).rows[0].count
      ).toBe(
        JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')).entries
          .length
      );
    } finally {
      close();
    }
  });

  it('preserves content change rows while adding the translation audit kind', async () => {
    const target = await fixture();
    const previous = await mkdtemp(join(tmpdir(), 'langlo-migrations-'));
    try {
      const journal = JSON.parse(
        await readFile('drizzle/meta/_journal.json', 'utf8')
      );
      journal.entries = journal.entries.slice(0, -1);
      await mkdir(join(previous, 'meta'));
      await writeFile(
        join(previous, 'meta/_journal.json'),
        JSON.stringify(journal)
      );
      for (const entry of journal.entries)
        await copyFile(
          `drizzle/${entry.tag}.sql`,
          join(previous, `${entry.tag}.sql`)
        );
      await migrateFixtureDatabase(target, previous);
      const before = await openFixtureDatabase(target);
      try {
        await before.client.execute({
          sql: 'INSERT INTO curriculum_imports (curriculum_version, fingerprint) VALUES (?, ?)',
          args: ['0.1.0', 'a'.repeat(64)]
        });
        await before.client.execute({
          sql: 'INSERT INTO content_changes (id, curriculum_version, kind, skill_id, content_version_id) VALUES (?, ?, ?, ?, ?)',
          args: [
            'change-before-0018',
            '0.1.0',
            'version-added',
            'en-a1-001',
            'en-a1-001@1'
          ]
        });
      } finally {
        before.close();
      }

      await migrateFixtureDatabase(target);
      const after = await openFixtureDatabase(target);
      try {
        expect(
          (
            await after.client.execute(
              'SELECT kind, skill_id, content_version_id FROM content_changes WHERE id = ?',
              ['change-before-0018']
            )
          ).rows
        ).toEqual([
          {
            kind: 'version-added',
            skill_id: 'en-a1-001',
            content_version_id: 'en-a1-001@1'
          }
        ]);
        await after.client.execute({
          sql: 'INSERT INTO content_changes (id, curriculum_version, kind, skill_id, content_version_id) VALUES (?, ?, ?, ?, ?)',
          args: [
            'change-after-0018',
            '0.1.0',
            'lesson-translation-added',
            'en-a1-001',
            'en-a1-001@1'
          ]
        });
        expect(
          (await after.client.execute('PRAGMA foreign_key_check')).rows
        ).toEqual([]);
      } finally {
        after.close();
      }
    } finally {
      await rm(previous, { recursive: true, force: true });
    }
  });

  it('keeps review-history primary keys and append-only triggers without a duplicate unique index', async () => {
    const target = await fixture();
    await migrateFixtureDatabase(target);
    const { client, close } = await openFixtureDatabase(target);
    try {
      const reviewTable = await client.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'native_flashcard_review_events'"
      );
      expect(String(reviewTable.rows[0].sql)).toMatch(/WITHOUT ROWID/iu);
      expect(
        (
          await client.execute(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'native_flashcard_review_events_idempotency'"
          )
        ).rows
      ).toEqual([]);
      expect(
        (
          await client.execute(
            "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN ('native_flashcard_review_events_no_delete', 'native_flashcard_review_events_no_replace', 'native_flashcard_review_events_no_update') ORDER BY name"
          )
        ).rows.map((row) => row.name)
      ).toEqual([
        'native_flashcard_review_events_no_delete',
        'native_flashcard_review_events_no_replace',
        'native_flashcard_review_events_no_update'
      ]);
    } finally {
      close();
    }
  });

  it('adds review snapshots without losing history or unreviewed lifecycle cleanup', async () => {
    const target = await fixture();
    const previous = await migrationPrefixBeforeLanglo10();
    try {
      await seedLegacyReviewHistory(target, previous);
      await migrateFixtureDatabase(target);
      const { client, close } = await openFixtureDatabase(target);
      try {
        await expectMigratedReviewHistory(client);
      } finally {
        close();
      }
    } finally {
      await rm(previous, { recursive: true, force: true });
    }
  });

  it('fails closed when a draft note has review history', async () => {
    const target = await fixture();
    const previous = await migrationPrefixBeforeLanglo10();
    try {
      await seedDraftWithReviewHistory(target, previous);
      await expectFailedDraftReviewMigration(target);
    } finally {
      await rm(previous, { recursive: true, force: true });
    }
  });

  it('upgrades the supported initial schema without changing owned attempts or evaluations', async () => {
    const target = await fixture();
    const previous = await mkdtemp(join(tmpdir(), 'langlo-migrations-'));
    try {
      const journal = JSON.parse(
        await readFile('drizzle/meta/_journal.json', 'utf8')
      );
      journal.entries = journal.entries.slice(0, 1);
      await mkdir(join(previous, 'meta'));
      await writeFile(
        join(previous, 'meta/_journal.json'),
        JSON.stringify(journal)
      );
      await copyFile(
        `drizzle/${journal.entries[0].tag}.sql`,
        join(previous, `${journal.entries[0].tag}.sql`)
      );
      await migrateFixtureDatabase(target, previous);
      await seedStudy(target);
      const beforeDb = await openFixtureDatabase(target);
      const beforeAttempts = (
        await beforeDb.client.execute(
          'SELECT id, owner_id, study_session_id, question_id, content_version_id, skill_id, language, submission_key, evidence_kind, answer, created_at FROM attempts'
        )
      ).rows;
      const beforeEvaluations = (
        await beforeDb.client.execute('SELECT * FROM evaluations')
      ).rows;
      beforeDb.close();
      await migrateFixtureDatabase(target);
      const { client, close } = await openFixtureDatabase(target);
      try {
        expect(
          (
            await client.execute(
              'SELECT id, owner_id, study_session_id, question_id, content_version_id, skill_id, language, submission_key, evidence_kind, answer, created_at FROM attempts'
            )
          ).rows
        ).toEqual(beforeAttempts);
        expect(
          (await client.execute('SELECT * FROM evaluations')).rows
        ).toEqual(beforeEvaluations);
        expect(
          (
            await client.execute(
              "SELECT name FROM sqlite_master WHERE name='deliveries'"
            )
          ).rows
        ).toHaveLength(1);
        expect((await client.execute('PRAGMA foreign_key_check')).rows).toEqual(
          []
        );
      } finally {
        close();
      }
    } finally {
      await rm(previous, { recursive: true, force: true });
    }
  });
});
