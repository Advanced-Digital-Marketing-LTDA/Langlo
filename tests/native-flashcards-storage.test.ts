import { afterEach, expect, it } from 'vitest';
import { approveNote, createNote } from '../src/lib/server/flashcards';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import {
  disposeFlashcardFixtures,
  fixture,
  seedBasicNote,
  testSession
} from './fixtures/flashcards';

afterEach(disposeFlashcardFixtures);

it.each([
  'ordinary text',
  '{{c2::wrong}}',
  '{{c1::}}',
  '{{c1::valid}} {{c12::wrong}}',
  '{{c1::valid}} {{c1::broken',
  '{{c{{c1::valid}}2::wrong}}'
])('rejects unsupported stored Cloze syntax: %s', async (text) => {
  const db = await openFixtureDatabase(await fixture());
  try {
    const note = await seedBasicNote(db.client, testSession('learner-a'));
    await expect(
      createNote(db.client, testSession('learner-a'), {
        id: 'note-10000000-0000-4000-8000-000000000003',
        sourceId: `langlo:v1:${'f'.repeat(64)}`,
        deckId: 'deck-10000000-0000-4000-8000-000000000002',
        kind: 'cloze',
        content: { text }
      })
    ).rejects.toMatchObject({ code: 'INVALID_CLOZE' });

    await expect(
      db.client.execute({
        sql: 'UPDATE native_flashcard_notes SET kind = ?, content_json = ? WHERE id = ?',
        args: ['cloze', JSON.stringify({ text }), note.id]
      })
    ).rejects.toThrow(/restricted cloze/iu);
    await expect(
      db.client.execute({
        sql: `INSERT INTO native_flashcard_notes (id, source_id, owner_id, deck_id, kind, content_json) SELECT 'new-note', 'langlo:v1:' || lower(hex(zeroblob(32))), owner_id, deck_id, 'cloze', ? FROM native_flashcard_notes WHERE id = ?`,
        args: [JSON.stringify({ text }), note.id]
      })
    ).rejects.toThrow(/restricted cloze/iu);

    await expect(
      db.client.execute({
        sql: `INSERT OR REPLACE INTO native_flashcard_notes (id, source_id, owner_id, deck_id, kind, content_json) SELECT id, source_id, owner_id, deck_id, 'cloze', ? FROM native_flashcard_notes WHERE id = ?`,
        args: [JSON.stringify({ text }), note.id]
      })
    ).rejects.toThrow(/restricted cloze/iu);
    const stored = await db.client.execute({
      sql: 'SELECT kind FROM native_flashcard_notes WHERE id = ?',
      args: [note.id]
    });
    expect(stored.rows[0].kind).toBe('basic');
  } finally {
    db.close();
  }
});

it.each([
  '{{c1::valid}}',
  '{{c1::𐐷::hint}} and {{c1::two\nlines}}',
  '{{cx::literal}} {{c1::valid}}',
  'x'.repeat(4083) + '{{c1::valid}}'
])('accepts supported stored Cloze syntax: %s', async (text) => {
  const db = await openFixtureDatabase(await fixture());
  try {
    const note = await seedBasicNote(db.client, testSession('learner-a'));
    await db.client.execute({
      sql: 'UPDATE native_flashcard_notes SET kind = ?, content_json = ? WHERE id = ?',
      args: ['cloze', JSON.stringify({ text }), note.id]
    });
    const stored = await db.client.execute({
      sql: 'SELECT content_json FROM native_flashcard_notes WHERE id = ?',
      args: [note.id]
    });
    expect(JSON.parse(String(stored.rows[0].content_json))).toEqual({ text });
    await db.client.execute({
      sql: `INSERT INTO native_flashcard_notes (id, source_id, owner_id, deck_id, kind, content_json) SELECT 'new-note', 'langlo:v1:' || lower(hex(zeroblob(32))), owner_id, deck_id, 'cloze', ? FROM native_flashcard_notes WHERE id = ?`,
      args: [JSON.stringify({ text }), note.id]
    });
    expect(
      (await db.client.execute('SELECT id FROM native_flashcard_notes')).rows
    ).toHaveLength(2);
  } finally {
    db.close();
  }
});

it.each([
  ['expected_revision', 'abc'],
  ['expected_revision', 0.5],
  ['expected_revision', -1],
  ['reviewed_at', 'abc'],
  ['reviewed_at', 0.5],
  ['reviewed_at', -1]
])('rejects invalid stored event %s = %s', async (field, value) => {
  const db = await openFixtureDatabase(await fixture());
  try {
    const note = await seedBasicNote(db.client, testSession('learner-a'));
    await expect(
      db.client.execute({
        sql: `INSERT INTO native_flashcard_review_events (id, owner_id, card_id, expected_revision, rating, reviewed_at, scheduler_version, parameters_json, result_json) VALUES ('bad-event', 'learner-a', ?, ?, 'good', ?, 'test', '{}', '{}')`,
        args: [
          note.cardId,
          field === 'expected_revision' ? value : 0,
          field === 'reviewed_at' ? value : 0
        ]
      })
    ).rejects.toThrow(/CHECK|CONSTRAINT/iu);
    expect(
      (await db.client.execute('SELECT * FROM native_flashcard_review_events'))
        .rows
    ).toHaveLength(0);
  } finally {
    db.close();
  }
});

it('accepts zero event timestamps and revisions as integer storage', async () => {
  const db = await openFixtureDatabase(await fixture());
  try {
    const note = await seedBasicNote(db.client, testSession('learner-a'));
    await approveNote(db.client, testSession('learner-a'), note.id);
    await db.client.execute({
      sql: `INSERT INTO native_flashcard_review_events (id, owner_id, card_id, expected_revision, rating, reviewed_at, scheduler_version, parameters_json, result_json) VALUES ('zero-event', 'learner-a', ?, 0, 'good', 0, 'test', '{}', '{}')`,
      args: [note.cardId]
    });
    const result = await db.client.execute(
      'SELECT expected_revision, reviewed_at, typeof(expected_revision) AS revision_type, typeof(reviewed_at) AS time_type FROM native_flashcard_review_events'
    );
    expect(result.rows[0]).toMatchObject({
      expected_revision: 0,
      reviewed_at: 0,
      revision_type: 'integer',
      time_type: 'integer'
    });
  } finally {
    db.close();
  }
});

it('allows legacy event snapshots to be null and rejects malformed new snapshots', async () => {
  const learner = testSession('learner-a');
  const db = await openFixtureDatabase(await fixture());
  try {
    const note = await seedBasicNote(db.client, learner);
    await approveNote(db.client, learner, note.id);
    await db.client.execute({
      sql: "INSERT INTO native_flashcard_review_events (id, owner_id, card_id, expected_revision, rating, reviewed_at, scheduler_version, parameters_json, result_json) VALUES (?, ?, ?, 0, 'good', 0, 'legacy', '{}', '{}')",
      args: [
        '10000000-0000-4000-8000-000000000099',
        learner.userId,
        note.cardId
      ]
    });
    expect(
      (
        await db.client.execute(
          'SELECT state_json FROM native_flashcard_review_events'
        )
      ).rows[0].state_json
    ).toBeNull();
    await expect(
      db.client.execute({
        sql: "INSERT INTO native_flashcard_review_events (id, owner_id, card_id, expected_revision, rating, reviewed_at, scheduler_version, parameters_json, result_json, state_json) VALUES (?, ?, ?, 0, 'good', 0, 'test', '{}', '{}', 'not-json')",
        args: [
          '10000000-0000-4000-8000-000000000098',
          learner.userId,
          note.cardId
        ]
      })
    ).rejects.toThrow(/CHECK|CONSTRAINT/iu);
  } finally {
    db.close();
  }
});
