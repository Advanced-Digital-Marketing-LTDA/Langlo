import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyCard, fsrs, generatorParameters, Rating } from 'ts-fsrs';
import { createClient } from '@libsql/client/sqlite3';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { listDueCards, searchNotes } from '../src/lib/server/flashcard-views';
import {
  approveNote,
  createDeck,
  createNote,
  getNote,
  listReviewEvents,
  previewStudySchedule,
  submitReview
} from '../src/lib/server/flashcards';
import {
  disposeFlashcardFixtures,
  fixture,
  seedBasicNote,
  testSession,
  testSourceId
} from './fixtures/flashcards';
import { studyDayStart } from '../src/lib/server/study-days';

afterEach(disposeFlashcardFixtures);

describe('native flashcard persistence feasibility', () => {
  it('finds uppercase accented note text from a lowercase search', async () => {
    const db = createClient({ url: 'file::memory:' });
    try {
      await db.batch(
        [
          'CREATE TABLE native_flashcard_decks (id TEXT, owner_id TEXT, name TEXT)',
          'CREATE TABLE native_flashcard_notes (id TEXT, owner_id TEXT, deck_id TEXT, kind TEXT, status TEXT, content_json TEXT, tags_json TEXT, explanation TEXT, created_at INTEGER)',
          "INSERT INTO native_flashcard_decks VALUES ('deck-one', 'learner-a', 'French')",
          "INSERT INTO native_flashcard_notes VALUES ('note-one', 'learner-a', 'deck-one', 'basic', 'approved', '{\"front\":\"ÉCOLE\",\"back\":\"school\"}', '[]', '', 1)"
        ],
        'write'
      );
      expect(
        (await searchNotes(db, { userId: 'learner-a' }, 'école')).results
      ).toMatchObject([{ id: 'note-one' }]);
      expect(
        (await searchNotes(db, { userId: 'learner-a' }, 'front')).results
      ).toEqual([]);
      expect(
        (await searchNotes(db, { userId: 'learner-a' }, '[]')).results
      ).toEqual([]);
      await db.batch(
        Array.from(
          { length: 55 },
          (_, index) =>
            `INSERT INTO native_flashcard_notes VALUES ('note-extra-${index}', 'learner-a', 'deck-one', 'basic', 'approved', '{"front":"ÉCOLE ${index}","back":"school"}', '[]', '', ${index + 2})`
        ),
        'write'
      );
      const firstPage = await searchNotes(db, { userId: 'learner-a' }, 'école');
      expect(firstPage.results).toHaveLength(50);
      expect(firstPage.nextCursor).not.toBeNull();
      const secondPage = await searchNotes(
        db,
        { userId: 'learner-a' },
        'école',
        firstPage.nextCursor!
      );
      expect(secondPage.results).toHaveLength(6);
      expect(secondPage.nextCursor).toBeNull();
      await db.execute(`WITH RECURSIVE seq(x) AS (SELECT 0 UNION ALL SELECT x + 1 FROM seq WHERE x < 1000)
        INSERT INTO native_flashcard_notes SELECT 'note-fill-' || x, 'learner-a', 'deck-one', 'basic', 'draft', '{"front":"filler","back":"school"}', '[]', '', x + 100 FROM seq`);
      await db.execute(
        `INSERT INTO native_flashcard_notes VALUES ('note-needle', 'learner-a', 'deck-one', 'basic', 'rejected', '{"front":"needle","back":"school"}', '[]', '', 2000)`
      );
      const emptyPage = await searchNotes(
        db,
        { userId: 'learner-a' },
        'needle'
      );
      expect(emptyPage.results).toEqual([]);
      expect(emptyPage.nextCursor).not.toBeNull();
      const laterPage = await searchNotes(
        db,
        { userId: 'learner-a' },
        'needle',
        emptyPage.nextCursor!
      );
      expect(laterPage.results).toMatchObject([
        { id: 'note-needle', status: 'rejected' }
      ]);
    } finally {
      db.close();
    }
  });

  it('loads due-card intervals without one note query per card', async () => {
    const target = await fixture();
    const learner = testSession('learner-a');
    const db = await openFixtureDatabase(target);
    try {
      await seedBasicNote(db.client, learner);
      await approveNote(
        db.client,
        learner,
        'note-10000000-0000-4000-8000-000000000002'
      );
      const execute = vi.spyOn(db.client, 'execute');
      const due = await listDueCards(db.client, learner, Date.now() + 1000);
      expect(due).toHaveLength(1);
      expect(due[0].intervals.good).toBe('10m');
      expect(execute).toHaveBeenCalledTimes(2);
    } finally {
      db.close();
    }
  });

  it('discloses when the seven-day preview caps its eligible cards', async () => {
    const target = await fixture();
    const learner = testSession('learner-a');
    const db = await openFixtureDatabase(target);
    try {
      await seedBasicNote(db.client, learner);
      await approveNote(
        db.client,
        learner,
        'note-10000000-0000-4000-8000-000000000002'
      );
      const original = db.client.execute.bind(db.client);
      const card = await original({
        sql: 'SELECT id, state_json, due_at, scheduler_version, parameters_json FROM native_flashcards WHERE owner_id = ?',
        args: [learner.userId]
      });
      const execute = vi
        .spyOn(db.client, 'execute')
        .mockImplementation((statement) => {
          if (
            String(
              (statement as unknown as { sql?: string }).sql ?? statement
            ).includes('FROM native_flashcards c')
          )
            return Promise.resolve({
              ...card,
              rows: Array.from({ length: 501 }, () => card.rows[0])
            });
          return original(statement);
        });
      const preview = await previewStudySchedule(db.client, learner, {
        desiredRetention: 90,
        newCardPreset: '1m+10m',
        relearningPreset: '10m'
      });
      expect(preview.scenario).toContain('500');
      expect(
        execute.mock.calls.find(([statement]) =>
          String(
            (statement as unknown as { sql?: string }).sql ?? statement
          ).includes('FROM native_flashcards c')
        )?.[0]
      ).toMatchObject({ sql: expect.stringContaining('c.due_at < ?') });
    } finally {
      db.close();
    }
  });

  it('keeps sub-day steps exact and aligns day intervals to the UTC study day', async () => {
    const target = await fixture();
    const learner = testSession('learner-a');
    const db = await openFixtureDatabase(target);
    try {
      await seedBasicNote(db.client, learner);
      await approveNote(
        db.client,
        learner,
        'note-10000000-0000-4000-8000-000000000002'
      );
      await submitReview(db.client, learner, {
        cardId: 'card:note-10000000-0000-4000-8000-000000000002',
        submissionId: '20000000-0000-4000-8000-000000000001',
        expectedRevision: 0,
        rating: 'good'
      });
      const firstEvent = (
        await listReviewEvents(
          db.client,
          learner,
          'card:note-10000000-0000-4000-8000-000000000002'
        )
      )[0];
      expect(firstEvent.state?.scheduled_days).toBe(0);
      expect(firstEvent.state!.due.getTime() - firstEvent.reviewedAt).toBe(
        10 * 60_000
      );
      await submitReview(db.client, learner, {
        cardId: 'card:note-10000000-0000-4000-8000-000000000002',
        submissionId: '20000000-0000-4000-8000-000000000002',
        expectedRevision: 1,
        rating: 'good'
      });
      const secondEvent = (
        await listReviewEvents(
          db.client,
          learner,
          'card:note-10000000-0000-4000-8000-000000000002'
        )
      )[1];
      expect(secondEvent.state?.scheduled_days).toBeGreaterThanOrEqual(1);
      expect(secondEvent.state?.due.getTime()).toBe(
        studyDayStart(
          new Date(secondEvent.reviewedAt),
          'UTC',
          Math.round(secondEvent.state!.scheduled_days)
        ).getTime()
      );
    } finally {
      db.close();
    }
  });

  it('keeps draft notes out of scheduler state until approval', async () => {
    const target = await fixture();
    const learner = testSession('learner-a');
    const db = await openFixtureDatabase(target);
    try {
      const note = await seedBasicNote(db.client, learner);
      expect(
        (
          await db.client.execute(
            'SELECT count(*) AS count FROM native_flashcards'
          )
        ).rows[0].count
      ).toBe(0);
      await expect(getNote(db.client, learner, note.id)).resolves.toMatchObject(
        {
          status: 'draft',
          card: null
        }
      );

      await approveNote(db.client, learner, note.id);
      await expect(getNote(db.client, learner, note.id)).resolves.toMatchObject(
        {
          status: 'approved',
          card: { id: note.cardId, revision: 0 }
        }
      );
      expect(
        (
          await db.client.execute(
            'SELECT count(*) AS count FROM native_flashcards'
          )
        ).rows[0].count
      ).toBe(1);
    } finally {
      db.close();
    }
  });

  it('keeps two learners’ identical content as separate notes and cards', async () => {
    const target = await fixture();
    const ownerA = testSession('learner-a');
    const ownerB = testSession('learner-b');
    const db = await openFixtureDatabase(target);
    try {
      const sourceId = `langlo:v1:${'1'.repeat(64)}`;
      for (const [label, owner] of [
        ['a', ownerA],
        ['b', ownerB]
      ] as const) {
        await createDeck(db.client, owner, {
          id: `deck-identical-${label}`,
          name: 'French'
        });
        await createNote(db.client, owner, {
          id: `note-identical-${label}`,
          sourceId,
          deckId: `deck-identical-${label}`,
          kind: 'basic',
          content: { front: 'Merci', back: 'Thank you' }
        });
      }
      expect(
        (
          await db.client.execute(
            'SELECT count(*) AS count FROM native_flashcard_notes'
          )
        ).rows[0].count
      ).toBe(2);
      expect(
        (
          await db.client.execute(
            'SELECT count(*) AS count FROM native_flashcards'
          )
        ).rows[0].count
      ).toBe(0);
      await expect(
        getNote(db.client, ownerA, 'note-identical-b')
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        getNote(db.client, ownerB, 'note-identical-a')
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      db.close();
    }
  });

  it('persists an approved Basic note across fresh test sessions and scopes it to its owner', async () => {
    const target = await fixture();
    const ownerA = testSession('learner-a');
    const ownerB = testSession('learner-b');
    const first = await openFixtureDatabase(target);
    try {
      await createDeck(first.client, ownerA, {
        id: 'deck-10000000-0000-4000-8000-000000000001',
        name: 'French'
      });
      await createNote(first.client, ownerA, {
        id: 'note-10000000-0000-4000-8000-000000000001',
        sourceId: testSourceId('10000000-0000-4000-8000-000000000001'),
        deckId: 'deck-10000000-0000-4000-8000-000000000001',
        kind: 'basic',
        content: { front: 'Bonjour', back: 'Hello' }
      });
      await approveNote(
        first.client,
        ownerA,
        'note-10000000-0000-4000-8000-000000000001'
      );
    } finally {
      first.close();
    }

    const second = await openFixtureDatabase(target);
    const ownerAReloaded = testSession(ownerA.userId);
    try {
      await expect(
        getNote(
          second.client,
          ownerAReloaded,
          'note-10000000-0000-4000-8000-000000000001'
        )
      ).resolves.toMatchObject({
        id: 'note-10000000-0000-4000-8000-000000000001',
        status: 'approved',
        content: { front: 'Bonjour', back: 'Hello' }
      });
      const firstReview = await submitReview(second.client, ownerAReloaded, {
        cardId: 'card:note-10000000-0000-4000-8000-000000000001',
        submissionId: '10000000-0000-4000-8000-000000000008',
        expectedRevision: 0,
        rating: 'good'
      });
      expect(firstReview.revision).toBe(1);
      await expect(
        getNote(
          second.client,
          ownerAReloaded,
          'note-10000000-0000-4000-8000-000000000001'
        )
      ).resolves.toMatchObject({ card: { revision: 1 } });
      await expect(
        getNote(
          second.client,
          ownerB,
          'note-10000000-0000-4000-8000-000000000001'
        )
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      second.close();
    }
  });

  it('requires approval before a native card can be reviewed', async () => {
    const target = await fixture();
    const learner = testSession('learner-a');
    const db = await openFixtureDatabase(target);
    try {
      const note = await seedBasicNote(db.client, learner);
      await expect(
        submitReview(db.client, learner, {
          cardId: note.cardId,
          submissionId: '10000000-0000-4000-8000-000000000001',
          expectedRevision: 0,
          rating: 'good'
        })
      ).rejects.toMatchObject({ code: 'NOT_APPROVED' });
    } finally {
      db.close();
    }
  });

  it('persists FSRS review state and its immutable event snapshot', async () => {
    const target = await fixture();
    const learner = testSession('learner-a');
    const db = await openFixtureDatabase(target);
    try {
      const note = await seedBasicNote(db.client, learner);
      await approveNote(db.client, learner, note.id);
      const submittedAt = Date.now();
      const review = {
        cardId: note.cardId,
        submissionId: 'a0000000-0000-4000-8000-000000000001',
        expectedRevision: 0,
        rating: 'good' as const
      };
      await expect(
        submitReview(db.client, learner, review)
      ).resolves.toMatchObject({
        duplicate: false,
        revision: 1
      });
      const persisted = await getNote(db.client, learner, note.id);
      expect(persisted.card).toMatchObject({
        revision: 1,
        schedulerVersion: 'ts-fsrs@5.4.2'
      });
      expect(persisted.card!.dueAt).toBeGreaterThan(submittedAt);
      await expect(
        listReviewEvents(db.client, learner, note.cardId)
      ).resolves.toMatchObject([
        {
          id: review.submissionId,
          state: persisted.card!.state
        }
      ]);
      expect(
        (
          await db.client.execute({
            sql: 'SELECT state_json FROM native_flashcard_review_events WHERE owner_id = ? AND id = ?',
            args: [learner.userId, review.submissionId]
          })
        ).rows[0].state_json
      ).toBe(JSON.stringify(persisted.card!.state));
    } finally {
      db.close();
    }
  });

  it('replays a review once and rejects a conflicting submission', async () => {
    const target = await fixture();
    const learner = testSession('learner-a');
    const db = await openFixtureDatabase(target);
    try {
      const note = await seedBasicNote(db.client, learner);
      await approveNote(db.client, learner, note.id);
      const submittedAt = Date.now();
      const review = {
        cardId: note.cardId,
        submissionId: 'a0000000-0000-4000-8000-000000000001',
        expectedRevision: 0,
        rating: 'good' as const
      };
      const first = await submitReview(db.client, learner, review);
      const retry = await submitReview(db.client, learner, {
        ...review,
        submissionId: review.submissionId.toUpperCase()
      });
      expect(retry).toMatchObject({
        duplicate: true,
        revision: first.revision
      });
      await expect(
        submitReview(db.client, learner, { ...review, rating: 'easy' })
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
      for (const query of [
        {
          sql: 'SELECT count(*) AS count FROM native_flashcard_review_events WHERE owner_id = ? AND reviewed_at BETWEEN ? AND ?',
          args: [learner.userId, submittedAt, Date.now()]
        },
        {
          sql: 'SELECT count(*) AS count FROM native_flashcard_review_events WHERE owner_id = ?',
          args: [learner.userId]
        }
      ]) {
        expect((await db.client.execute(query)).rows[0].count).toBe(1);
      }
    } finally {
      db.close();
    }
  });

  it('rejects stale review revisions', async () => {
    const target = await fixture();
    const learner = testSession('learner-a');
    const db = await openFixtureDatabase(target);
    try {
      const note = await seedBasicNote(db.client, learner);
      await approveNote(db.client, learner, note.id);
      const review = {
        cardId: note.cardId,
        submissionId: 'a0000000-0000-4000-8000-000000000001',
        expectedRevision: 0,
        rating: 'good' as const
      };
      await submitReview(db.client, learner, review);
      await expect(
        submitReview(db.client, learner, {
          ...review,
          submissionId: '10000000-0000-4000-8000-000000000002',
          rating: 'again'
        })
      ).rejects.toMatchObject({ code: 'STALE_REVIEW' });
    } finally {
      db.close();
    }
  });

  it('rejects direct mutation and replacement of persisted review history', async () => {
    const target = await fixture();
    const learner = testSession('learner-a');
    const db = await openFixtureDatabase(target);
    try {
      const note = await seedBasicNote(db.client, learner);
      await approveNote(db.client, learner, note.id);
      const submittedAt = Date.now();
      const submissionId = '10000000-0000-4000-8000-000000000001';
      await submitReview(db.client, learner, {
        cardId: note.cardId,
        submissionId,
        expectedRevision: 0,
        rating: 'good'
      });
      await db.client.execute('PRAGMA recursive_triggers = OFF');
      const replacementArgs = (id: string, reviewedAt: number) => [
        id,
        learner.userId,
        note.cardId,
        0,
        'easy',
        reviewedAt,
        'ts-fsrs@5.4.2',
        '{}',
        '{}'
      ];
      for (const { sql, args, error } of [
        {
          sql: 'UPDATE native_flashcard_review_events SET rating = ? WHERE owner_id = ? AND id = ?',
          args: ['again', learner.userId, submissionId],
          error: /cannot be updated/iu
        },
        {
          sql: 'DELETE FROM native_flashcard_review_events WHERE owner_id = ? AND id = ?',
          args: [learner.userId, submissionId],
          error: /cannot be deleted/iu
        },
        {
          sql: 'INSERT OR REPLACE INTO native_flashcard_review_events (id, owner_id, card_id, expected_revision, rating, reviewed_at, scheduler_version, parameters_json, result_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          args: replacementArgs(submissionId, submittedAt + 1),
          error: /cannot be replaced/iu
        },
        {
          sql: 'INSERT OR REPLACE INTO native_flashcard_review_events (rowid, id, owner_id, card_id, expected_revision, rating, reviewed_at, scheduler_version, parameters_json, result_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          args: [
            1,
            ...replacementArgs(
              '10000000-0000-4000-8000-000000000099',
              submittedAt + 2
            )
          ],
          error: /rowid|column/iu
        }
      ]) {
        await expect(db.client.execute({ sql, args })).rejects.toThrow(error);
      }
      expect(
        (
          await db.client.execute(
            'SELECT rating FROM native_flashcard_review_events WHERE owner_id = ? AND id = ?',
            [learner.userId, submissionId]
          )
        ).rows[0].rating
      ).toBe('good');

      const persisted = await getNote(db.client, learner, note.id);
      expect(persisted.card).toMatchObject({
        revision: 1,
        schedulerVersion: 'ts-fsrs@5.4.2'
      });
      expect(persisted.card!.dueAt).toBeGreaterThan(submittedAt);
    } finally {
      db.close();
    }
  });

  it('rejects non-integer or out-of-range scheduling fields from direct SQL writers', async () => {
    const target = await fixture();
    const learner = testSession('learner-a');
    const db = await openFixtureDatabase(target);
    try {
      await createDeck(db.client, learner, {
        id: 'deck-10000000-0000-4000-8000-000000000025',
        name: 'French'
      });
      const note = await createNote(db.client, learner, {
        id: 'note-10000000-0000-4000-8000-000000000025',
        sourceId: testSourceId('10000000-0000-4000-8000-000000000025'),
        deckId: 'deck-10000000-0000-4000-8000-000000000025',
        kind: 'basic',
        content: { front: 'Bonjour', back: 'Hello' }
      });
      await approveNote(db.client, learner, note.id);

      for (const [column, value] of [
        ['ordinal', 0.5],
        ['due_at', 'abc'],
        ['due_at', -1],
        ['revision', 'abc'],
        ['revision', 0.5],
        ['suspended', 'false'],
        ['suspended', 2]
      ]) {
        await expect(
          db.client.execute(
            `UPDATE native_flashcards SET ${column} = ? WHERE id = ? AND owner_id = ?`,
            [value, note.cardId, learner.userId]
          )
        ).rejects.toThrow(/CHECK|CONSTRAINT/iu);
      }

      await expect(getNote(db.client, learner, note.id)).resolves.toMatchObject(
        {
          card: { revision: 0, suspended: false }
        }
      );
    } finally {
      db.close();
    }
  });

  it('rejects another learner review attempts without changing the owner’s card or grammar evidence', async () => {
    const target = await fixture();
    const ownerA = testSession('learner-a');
    const ownerB = testSession('learner-b');
    const db = await openFixtureDatabase(target);
    try {
      await createDeck(db.client, ownerA, {
        id: 'deck-10000000-0000-4000-8000-000000000003',
        name: 'French'
      });
      const note = await createNote(db.client, ownerA, {
        id: 'note-10000000-0000-4000-8000-000000000003',
        sourceId: testSourceId('10000000-0000-4000-8000-000000000003'),
        deckId: 'deck-10000000-0000-4000-8000-000000000003',
        kind: 'basic',
        content: { front: 'Au revoir', back: 'Goodbye' }
      });
      await approveNote(db.client, ownerA, note.id);
      const evidenceBefore = (
        await db.client.execute(
          'SELECT * FROM skill_evidence WHERE owner_id = ? ORDER BY id',
          [ownerA.userId]
        )
      ).rows;
      await expect(getNote(db.client, ownerB, note.id)).rejects.toMatchObject({
        code: 'NOT_FOUND'
      });
      await expect(
        submitReview(db.client, ownerB, {
          cardId: note.cardId,
          submissionId: '10000000-0000-4000-8000-000000000003',
          expectedRevision: 0,
          rating: 'easy'
        })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(
        (
          await db.client.execute(
            'SELECT * FROM skill_evidence WHERE owner_id = ? ORDER BY id',
            [ownerA.userId]
          )
        ).rows
      ).toEqual(evidenceBefore);
      expect((await getNote(db.client, ownerA, note.id)).card?.revision).toBe(
        0
      );
    } finally {
      db.close();
    }
  });

  it('rolls back the card snapshot when the review event cannot be appended', async () => {
    const target = await fixture();
    const learner = testSession('learner-a');
    const db = await openFixtureDatabase(target);
    try {
      await createDeck(db.client, learner, {
        id: 'deck-10000000-0000-4000-8000-000000000030',
        name: 'French'
      });
      const note = await createNote(db.client, learner, {
        id: 'note-10000000-0000-4000-8000-000000000030',
        sourceId: testSourceId('10000000-0000-4000-8000-000000000030'),
        deckId: 'deck-10000000-0000-4000-8000-000000000030',
        kind: 'basic',
        content: { front: 'Merci', back: 'Thank you' }
      });
      await approveNote(db.client, learner, note.id);
      const before = await getNote(db.client, learner, note.id);
      await db.client.execute(
        "CREATE TRIGGER review_event_failure BEFORE INSERT ON native_flashcard_review_events BEGIN SELECT RAISE(ABORT, 'synthetic event failure'); END"
      );
      const review = {
        cardId: note.cardId,
        submissionId: '10000000-0000-4000-8000-000000000030',
        expectedRevision: 0,
        rating: 'good' as const
      };
      await expect(submitReview(db.client, learner, review)).rejects.toThrow(
        /synthetic event failure/u
      );
      // The failed event append must leave the scheduler snapshot untouched.
      const after = await getNote(db.client, learner, note.id);
      expect(after.card).toEqual(before.card);
      expect(
        (
          await db.client.execute(
            'SELECT count(*) AS count FROM native_flashcard_review_events WHERE owner_id = ?',
            [learner.userId]
          )
        ).rows[0].count
      ).toBe(0);

      await db.client.execute('DROP TRIGGER review_event_failure');
      expect(await submitReview(db.client, learner, review)).toMatchObject({
        revision: 1,
        duplicate: false
      });
      expect((await getNote(db.client, learner, note.id)).card?.revision).toBe(
        1
      );
    } finally {
      db.close();
    }
  });

  it('accepts only one of two concurrent reviews submitted against the same revision', async () => {
    const target = await fixture();
    const learner = testSession('learner-a');
    const db = await openFixtureDatabase(target);
    try {
      await createDeck(db.client, learner, {
        id: 'deck-10000000-0000-4000-8000-000000000006',
        name: 'French'
      });
      const note = await createNote(db.client, learner, {
        id: 'note-10000000-0000-4000-8000-000000000006',
        sourceId: testSourceId('10000000-0000-4000-8000-000000000006'),
        deckId: 'deck-10000000-0000-4000-8000-000000000006',
        kind: 'basic',
        content: { front: 'Oui', back: 'Yes' }
      });
      await approveNote(db.client, learner, note.id);
      const common = {
        cardId: note.cardId,
        expectedRevision: 0
      };
      const results = await Promise.allSettled([
        submitReview(db.client, learner, {
          ...common,
          submissionId: '10000000-0000-4000-8000-000000000006',
          rating: 'good'
        }),
        submitReview(db.client, learner, {
          ...common,
          submissionId: '10000000-0000-4000-8000-000000000007',
          rating: 'hard'
        })
      ]);
      expect(
        results.filter((result) => result.status === 'fulfilled')
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === 'rejected')
      ).toHaveLength(1);
      expect(
        results.find((result) => result.status === 'rejected')
      ).toMatchObject({
        reason: { code: 'STALE_REVIEW' }
      });
      expect((await getNote(db.client, learner, note.id)).card?.revision).toBe(
        1
      );
      expect(
        (
          await db.client.execute(
            'SELECT count(*) AS count FROM native_flashcard_review_events WHERE owner_id = ?',
            [learner.userId]
          )
        ).rows[0].count
      ).toBe(1);
    } finally {
      db.close();
    }
  });

  it('erases reviewed cards and their history when the owner is deleted', async () => {
    const target = await fixture();
    const learner = testSession('learner-a');
    const db = await openFixtureDatabase(target);
    try {
      await createDeck(db.client, learner, {
        id: 'deck-10000000-0000-4000-8000-000000000007',
        name: 'French'
      });
      const note = await createNote(db.client, learner, {
        id: 'note-10000000-0000-4000-8000-000000000007',
        sourceId: testSourceId('10000000-0000-4000-8000-000000000007'),
        deckId: 'deck-10000000-0000-4000-8000-000000000007',
        kind: 'basic',
        content: { front: 'Bonjour', back: 'Hello' }
      });
      await approveNote(db.client, learner, note.id);
      await submitReview(db.client, learner, {
        cardId: note.cardId,
        submissionId: '10000000-0000-4000-8000-000000000010',
        expectedRevision: 0,
        rating: 'good'
      });

      await expect(
        db.client.execute('DELETE FROM users WHERE id = ?', [learner.userId])
      ).resolves.toBeDefined();
      for (const table of [
        'native_flashcard_decks',
        'native_flashcard_notes',
        'native_flashcards',
        'native_flashcard_review_events'
      ]) {
        expect(
          (
            await db.client.execute(
              `SELECT count(*) AS count FROM ${table} WHERE owner_id = ?`,
              [learner.userId]
            )
          ).rows[0].count
        ).toBe(0);
      }
    } finally {
      db.close();
    }
  });

  it('preserves non-user FSRS parameters and applies the learner schedule to reviews', async () => {
    const target = await fixture();
    const learner = testSession('learner-a');
    const db = await openFixtureDatabase(target);
    try {
      await createDeck(db.client, learner, {
        id: 'deck-10000000-0000-4000-8000-000000000008',
        name: 'French'
      });
      const note = await createNote(db.client, learner, {
        id: 'note-10000000-0000-4000-8000-000000000008',
        sourceId: testSourceId('10000000-0000-4000-8000-000000000008'),
        deckId: 'deck-10000000-0000-4000-8000-000000000008',
        kind: 'basic',
        content: { front: 'Bonjour', back: 'Hello' }
      });
      const cardParameters = generatorParameters({
        learning_steps: ['1d'],
        relearning_steps: ['1d']
      });
      const effectiveParameters = generatorParameters({
        ...cardParameters,
        enable_fuzz: true,
        learning_steps: ['1m', '10m'],
        relearning_steps: ['10m']
      });
      await approveNote(db.client, learner, note.id);
      await db.client.execute(
        'UPDATE native_flashcards SET parameters_json = ? WHERE id = ? AND owner_id = ?',
        [JSON.stringify(cardParameters), note.cardId, learner.userId]
      );
      const submissionId = 'a0000000-0000-4000-8000-000000000011';
      const result = await submitReview(db.client, learner, {
        cardId: note.cardId,
        submissionId,
        expectedRevision: 0,
        rating: 'good'
      });
      const event = (
        await db.client.execute(
          'SELECT reviewed_at, parameters_json FROM native_flashcard_review_events WHERE owner_id = ? AND id = ?',
          [learner.userId, submissionId]
        )
      ).rows[0];
      expect(JSON.parse(String(event.parameters_json))).toEqual(
        effectiveParameters
      );
      const reviewedAt = new Date(Number(event.reviewed_at));
      const expectedDue = fsrs(effectiveParameters)
        .next(createEmptyCard(reviewedAt), reviewedAt, Rating.Good)
        .card.due.getTime();
      expect(result.dueAt).toBe(expectedDue);
    } finally {
      db.close();
    }
  });

  it('rejects cards written by an unsupported scheduler version without changing them', async () => {
    const target = await fixture();
    const learner = testSession('learner-a');
    const db = await openFixtureDatabase(target);
    try {
      await createDeck(db.client, learner, {
        id: 'deck-10000000-0000-4000-8000-000000000009',
        name: 'French'
      });
      const note = await createNote(db.client, learner, {
        id: 'note-10000000-0000-4000-8000-000000000009',
        sourceId: testSourceId('10000000-0000-4000-8000-000000000009'),
        deckId: 'deck-10000000-0000-4000-8000-000000000009',
        kind: 'basic',
        content: { front: 'Bonjour', back: 'Hello' }
      });
      await approveNote(db.client, learner, note.id);
      await db.client.execute(
        'UPDATE native_flashcards SET scheduler_version = ? WHERE id = ? AND owner_id = ?',
        ['ts-fsrs@unsupported', note.cardId, learner.userId]
      );

      await expect(
        submitReview(db.client, learner, {
          cardId: note.cardId,
          submissionId: '10000000-0000-4000-8000-000000000012',
          expectedRevision: 0,
          rating: 'good'
        })
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEDULER_VERSION' });
      await db.client.execute(
        'UPDATE native_flashcards SET scheduler_version = ?, parameters_json = ? WHERE id = ? AND owner_id = ?',
        ['ts-fsrs@5.4.2', '{}', note.cardId, learner.userId]
      );
      await expect(
        submitReview(db.client, learner, {
          cardId: note.cardId,
          submissionId: '10000000-0000-4000-8000-000000000013',
          expectedRevision: 0,
          rating: 'good'
        })
      ).rejects.toMatchObject({ code: 'INVALID_SCHEDULER_STATE' });
      await expect(getNote(db.client, learner, note.id)).rejects.toMatchObject({
        code: 'INVALID_SCHEDULER_STATE'
      });
      expect(
        (
          await db.client.execute(
            'SELECT count(*) AS count FROM native_flashcard_review_events WHERE card_id = ?',
            [note.cardId]
          )
        ).rows[0].count
      ).toBe(0);
    } finally {
      db.close();
    }
  });

  it('rejects empty review submission identifiers before scheduling', async () => {
    const target = await fixture();
    const learner = testSession('learner-a');
    const db = await openFixtureDatabase(target);
    try {
      await createDeck(db.client, learner, {
        id: 'deck-10000000-0000-4000-8000-000000000011',
        name: 'French'
      });
      const note = await createNote(db.client, learner, {
        id: 'note-10000000-0000-4000-8000-000000000014',
        sourceId: testSourceId('10000000-0000-4000-8000-000000000014'),
        deckId: 'deck-10000000-0000-4000-8000-000000000011',
        kind: 'basic',
        content: { front: 'Bonjour', back: 'Hello' }
      });
      await approveNote(db.client, learner, note.id);
      await expect(
        submitReview(db.client, learner, {
          cardId: note.cardId,
          submissionId: '   ',
          expectedRevision: 0,
          rating: 'good'
        })
      ).rejects.toMatchObject({ code: 'INVALID_SUBMISSION_ID' });
      await expect(
        submitReview(db.client, learner, {
          cardId: note.cardId,
          submissionId: 'not-a-uuid',
          expectedRevision: 0,
          rating: 'good'
        })
      ).rejects.toMatchObject({ code: 'INVALID_SUBMISSION_ID' });
      await expect(
        submitReview(db.client, learner, {
          cardId: note.cardId,
          submissionId: '𐐷'.repeat(257),
          expectedRevision: 0,
          rating: 'good'
        })
      ).rejects.toMatchObject({ code: 'INVALID_SUBMISSION_ID' });
      await expect(
        db.client.execute({
          sql: 'INSERT INTO native_flashcard_review_events (id, owner_id, card_id, expected_revision, rating, reviewed_at, scheduler_version, parameters_json, result_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          args: [
            '\t\n\u00a0\ufeff',
            learner.userId,
            note.cardId,
            0,
            'good',
            Date.now(),
            'ts-fsrs@5.4.2',
            '{}',
            '{}'
          ]
        })
      ).rejects.toThrow(/CHECK|CONSTRAINT/iu);
      expect((await getNote(db.client, learner, note.id)).card?.revision).toBe(
        0
      );
    } finally {
      db.close();
    }
  });

  it('reports malformed persisted card JSON as a stable flashcard error', async () => {
    const target = await fixture();
    const learner = testSession('learner-a');
    const db = await openFixtureDatabase(target);
    try {
      await createDeck(db.client, learner, {
        id: 'deck-10000000-0000-4000-8000-000000000012',
        name: 'French'
      });
      const note = await createNote(db.client, learner, {
        id: 'note-10000000-0000-4000-8000-000000000017',
        sourceId: testSourceId('10000000-0000-4000-8000-000000000017'),
        deckId: 'deck-10000000-0000-4000-8000-000000000012',
        kind: 'basic',
        content: { front: 'Bonjour', back: 'Hello' }
      });
      await approveNote(db.client, learner, note.id);
      await db.client.execute('PRAGMA ignore_check_constraints = ON');
      await db.client.execute(
        "UPDATE native_flashcards SET state_json = 'not-json' WHERE id = ? AND owner_id = ?",
        [note.cardId, learner.userId]
      );
      await db.client.execute('PRAGMA ignore_check_constraints = OFF');

      await expect(getNote(db.client, learner, note.id)).rejects.toMatchObject({
        code: 'INVALID_CARD_STATE'
      });
    } finally {
      db.close();
    }
  });

  it('rejects persisted card objects missing required FSRS state', async () => {
    const target = await fixture();
    const learner = testSession('learner-a');
    const db = await openFixtureDatabase(target);
    try {
      await createDeck(db.client, learner, {
        id: 'deck-10000000-0000-4000-8000-000000000030',
        name: 'French'
      });
      const note = await createNote(db.client, learner, {
        id: 'note-10000000-0000-4000-8000-000000000030',
        sourceId: testSourceId('10000000-0000-4000-8000-000000000030'),
        deckId: 'deck-10000000-0000-4000-8000-000000000030',
        kind: 'basic',
        content: { front: 'Bonjour', back: 'Hello' }
      });
      await approveNote(db.client, learner, note.id);
      await db.client.execute(
        'UPDATE native_flashcards SET state_json = \'{"due":"2026-01-01T00:00:00.000Z"}\' WHERE id = ? AND owner_id = ?',
        [note.cardId, learner.userId]
      );
      await expect(getNote(db.client, learner, note.id)).rejects.toMatchObject({
        code: 'INVALID_CARD_STATE'
      });
    } finally {
      db.close();
    }
  });

  it('rejects runtime-invalid ratings and reviews of suspended cards', async () => {
    const target = await fixture();
    const learner = testSession('learner-a');
    const db = await openFixtureDatabase(target);
    try {
      await createDeck(db.client, learner, {
        id: 'deck-10000000-0000-4000-8000-000000000031',
        name: 'French'
      });
      const note = await createNote(db.client, learner, {
        id: 'note-10000000-0000-4000-8000-000000000031',
        sourceId: testSourceId('10000000-0000-4000-8000-000000000031'),
        deckId: 'deck-10000000-0000-4000-8000-000000000031',
        kind: 'basic',
        content: { front: 'Bonjour', back: 'Hello' }
      });
      await approveNote(db.client, learner, note.id);
      const invalidRating = submitReview(db.client, learner, {
        cardId: note.cardId,
        submissionId: '10000000-0000-4000-8000-000000000031',
        expectedRevision: 0,
        rating: 'constructor'
      } as unknown as Parameters<typeof submitReview>[2]);
      await expect(invalidRating).rejects.toMatchObject({
        code: 'INVALID_RATING'
      });
      await db.client.execute(
        'UPDATE native_flashcards SET suspended = 1 WHERE id = ? AND owner_id = ?',
        [note.cardId, learner.userId]
      );
      await expect(
        submitReview(db.client, learner, {
          cardId: note.cardId,
          submissionId: '10000000-0000-4000-8000-000000000032',
          expectedRevision: 0,
          rating: 'good'
        })
      ).rejects.toMatchObject({ code: 'SUSPENDED' });
    } finally {
      db.close();
    }
  });
});
