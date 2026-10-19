import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyCard, fsrs, generatorParameters, Rating } from 'ts-fsrs';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import {
  approveNote,
  createDeck,
  createNote,
  getNote,
  submitReview
} from '../src/lib/server/flashcards';
import {
  disposeFlashcardFixtures,
  fixture,
  seedBasicNote,
  testSession,
  testSourceId
} from './fixtures/flashcards';

afterEach(disposeFlashcardFixtures);

describe('native flashcard persistence feasibility', () => {
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
      ).toBe(2);
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
        submissionId: 'review-10000000-0000-4000-8000-000000000008',
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

  it('requires approval and persists a real FSRS review exactly once, rejecting a stale revision', async () => {
    const target = await fixture();
    const learner = testSession('learner-a');
    const db = await openFixtureDatabase(target);
    try {
      const note = await seedBasicNote(db.client, learner);
      await expect(
        submitReview(db.client, learner, {
          cardId: note.cardId,
          submissionId: 'review-10000000-0000-4000-8000-000000000001',
          expectedRevision: 0,
          rating: 'good'
        })
      ).rejects.toMatchObject({ code: 'NOT_APPROVED' });

      await approveNote(db.client, learner, note.id);
      const submittedAt = Date.now();
      const review = {
        cardId: note.cardId,
        submissionId: 'review-10000000-0000-4000-8000-000000000001',
        expectedRevision: 0,
        rating: 'good' as const
      };
      const first = await submitReview(db.client, learner, review);
      const retry = await submitReview(db.client, learner, review);
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
      await expect(
        submitReview(db.client, learner, {
          ...review,
          submissionId: 'review-10000000-0000-4000-8000-000000000002',
          expectedRevision: 0,
          rating: 'again'
        })
      ).rejects.toMatchObject({ code: 'STALE_REVIEW' });
      const persisted = await getNote(db.client, learner, note.id);
      expect(persisted.card).toMatchObject({
        revision: 1,
        schedulerVersion: 'ts-fsrs@5.4.2'
      });
      expect(persisted.card.dueAt).toBeGreaterThan(submittedAt);
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
      const submissionId = 'review-10000000-0000-4000-8000-000000000001';
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
              'review-10000000-0000-4000-8000-000000000099',
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
      expect(persisted.card.dueAt).toBeGreaterThan(submittedAt);
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
          submissionId: 'review-10000000-0000-4000-8000-000000000003',
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
      expect((await getNote(db.client, ownerA, note.id)).card.revision).toBe(0);
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
        submissionId: 'review-10000000-0000-4000-8000-000000000030',
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
      expect((await getNote(db.client, learner, note.id)).card.revision).toBe(
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
          submissionId: 'review-10000000-0000-4000-8000-000000000006',
          rating: 'good'
        }),
        submitReview(db.client, learner, {
          ...common,
          submissionId: 'review-10000000-0000-4000-8000-000000000007',
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
      expect((await getNote(db.client, learner, note.id)).card.revision).toBe(
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
        submissionId: 'review-10000000-0000-4000-8000-000000000010',
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

  it('uses each card’s persisted FSRS parameters when scheduling and recording reviews', async () => {
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
      await db.client.execute(
        'UPDATE native_flashcards SET parameters_json = ? WHERE id = ? AND owner_id = ?',
        [JSON.stringify(cardParameters), note.cardId, learner.userId]
      );
      await approveNote(db.client, learner, note.id);
      const submissionId = 'review-10000000-0000-4000-8000-000000000011';
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
      expect(JSON.parse(String(event.parameters_json))).toEqual(cardParameters);
      const reviewedAt = new Date(Number(event.reviewed_at));
      const expectedDue = fsrs(cardParameters)
        .next(createEmptyCard(reviewedAt), reviewedAt, Rating.Good)
        .card.due.getTime();
      const defaultDue = fsrs()
        .next(createEmptyCard(reviewedAt), reviewedAt, Rating.Good)
        .card.due.getTime();
      expect(result.dueAt).toBe(expectedDue);
      expect(result.dueAt).not.toBe(defaultDue);
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
          submissionId: 'review-10000000-0000-4000-8000-000000000012',
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
          submissionId: 'review-10000000-0000-4000-8000-000000000013',
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
      expect((await getNote(db.client, learner, note.id)).card.revision).toBe(
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
        submissionId: 'review-10000000-0000-4000-8000-000000000031',
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
          submissionId: 'review-10000000-0000-4000-8000-000000000032',
          expectedRevision: 0,
          rating: 'good'
        })
      ).rejects.toMatchObject({ code: 'SUSPENDED' });
    } finally {
      db.close();
    }
  });
});
