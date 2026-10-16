import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import {
  approveNote,
  createDeck,
  createNote,
  getNote,
  listDecks,
  listReviewEvents,
  submitReview
} from '../src/lib/server/flashcards';
import {
  getAttempt,
  getStudySession,
  listAttempts,
  listEvaluations,
  listStudySessions,
  recordAttempt
} from '../src/lib/server/study';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession,
  testSourceId
} from './fixtures/flashcards';
import { privateState } from './fixtures/owner-scope';

// Synthetic principals from tests/fixtures/study.ts. These prove repository
// scoping only; they are not real session-derived acceptance.
const ownerA = testSession('learner-a');
const ownerB = testSession('learner-b');

let client: Client;
let close: (() => void) | undefined;

beforeEach(async () => {
  const target = await fixture();
  ({ client, close } = await openFixtureDatabase(target));
  // Owner B's flashcard history: deck, approved note, reviewed card.
  await createDeck(client, ownerB, { id: 'deck-b', name: 'Deutsch' });
  await createNote(client, ownerB, {
    id: 'note-b',
    sourceId: testSourceId('b'),
    deckId: 'deck-b',
    kind: 'basic',
    content: { front: 'Danke', back: 'Thanks' }
  });
  await approveNote(client, ownerB, 'note-b');
  await submitReview(client, ownerB, {
    cardId: 'card:note-b',
    submissionId: 'review-b',
    expectedRevision: 0,
    rating: 'good'
  });
});

afterEach(async () => {
  close?.();
  close = undefined;
  await disposeFlashcardFixtures();
});

const guessed = [
  'study-b',
  'attempt-a',
  'evaluation-a',
  'deck-b',
  'note-b',
  'card:note-b',
  'review-b',
  '',
  ' ',
  "' OR 1=1 --",
  '%',
  'learner-b'
];

describe('grammar study repository', () => {
  it('lists and reads only the caller’s own study sessions', async () => {
    expect(
      (await listStudySessions(client, ownerA)).map((row) => row.id)
    ).toEqual(['study-a']);
    expect(
      (await listStudySessions(client, ownerB)).map((row) => row.id)
    ).toEqual(['study-b']);
    await expect(
      getStudySession(client, ownerA, 'study-a')
    ).resolves.toMatchObject({ id: 'study-a', mode: 'practice' });
    await expect(getStudySession(client, ownerB, 'study-a')).rejects.toThrow(
      'NOT_FOUND'
    );
    await expect(getStudySession(client, ownerA, 'study-b')).rejects.toThrow(
      'NOT_FOUND'
    );
  });

  it('reads attempts and evaluations only for their owner', async () => {
    await expect(
      getAttempt(client, ownerA, 'attempt-a')
    ).resolves.toMatchObject({
      id: 'attempt-a',
      studySessionId: 'study-a',
      answer: 'un',
      evaluations: [{ id: 'evaluation-a', outcome: 'incorrect' }]
    });
    await expect(getAttempt(client, ownerB, 'attempt-a')).rejects.toThrow(
      'NOT_FOUND'
    );
    await expect(listAttempts(client, ownerB, 'study-a')).rejects.toThrow(
      'NOT_FOUND'
    );
    await expect(listEvaluations(client, ownerB, 'attempt-a')).rejects.toThrow(
      'NOT_FOUND'
    );
    expect(
      (await listEvaluations(client, ownerA, 'attempt-a')).map((row) => row.id)
    ).toEqual(['evaluation-a']);
  });

  it('records an attempt in the caller’s own session idempotently', async () => {
    const input = {
      studySessionId: 'study-b',
      questionId: 'question-1',
      submissionKey: 'submit-b-1',
      evidenceKind: 'independent' as const,
      answer: 'le'
    };
    const first = await recordAttempt(client, ownerB, input);
    expect(first.duplicate).toBe(false);
    const again = await recordAttempt(client, ownerB, input);
    expect(again).toEqual({ id: first.id, duplicate: true });
    await expect(
      recordAttempt(client, ownerB, { ...input, answer: 'la' })
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    await expect(getAttempt(client, ownerB, first.id)).resolves.toMatchObject({
      ownerId: 'learner-b',
      studySessionId: 'study-b',
      contentVersionId: 'content-v1',
      skillId: 'fr-articles',
      language: 'fr'
    });
    expect(
      (await listAttempts(client, ownerB, 'study-b')).map((row) => row.id)
    ).toEqual([first.id]);
    await expect(getAttempt(client, ownerA, first.id)).rejects.toThrow(
      'NOT_FOUND'
    );
  });

  it('shares no submission-key namespace across owners', async () => {
    // Owner A already used submit-a; owner B reusing it must neither replay A's
    // attempt nor conflict with it.
    const result = await recordAttempt(client, ownerB, {
      studySessionId: 'study-b',
      questionId: 'question-1',
      submissionKey: 'submit-a',
      evidenceKind: 'independent',
      answer: 'un'
    });
    expect(result).toMatchObject({ duplicate: false });
    expect(result.id).not.toBe('attempt-a');
  });

  it('rejects malformed attempt input before writing', async () => {
    const before = await privateState(client);
    const base = {
      studySessionId: 'study-a',
      questionId: 'question-1',
      submissionKey: 'submit-x',
      evidenceKind: 'independent' as const,
      answer: 'un'
    };
    for (const bad of [
      { ...base, submissionKey: ' ' },
      { ...base, submissionKey: 'x'.repeat(257) },
      { ...base, evidenceKind: 'forged' as 'independent' },
      { ...base, answer: 7 as unknown as string }
    ]) {
      await expect(recordAttempt(client, ownerA, bad)).rejects.toThrow(
        /INVALID_/
      );
    }
    expect(await privateState(client)).toEqual(before);
  });
});

describe('forged identifiers yield zero cross-owner reads and writes', () => {
  it('guessed study, attempt and evaluation IDs read nothing for another owner', async () => {
    const own = {
      'learner-a': ['study-a', 'attempt-a', 'evaluation-a'],
      'learner-b': ['study-b']
    };
    for (const learner of [ownerA, ownerB]) {
      const foreign = [...guessed, 'study-a'].filter(
        (id) => !own[learner.userId as keyof typeof own].includes(id)
      );
      for (const id of foreign) {
        await expect(getStudySession(client, learner, id)).rejects.toThrow(
          'NOT_FOUND'
        );
        await expect(listAttempts(client, learner, id)).rejects.toThrow(
          'NOT_FOUND'
        );
        await expect(getAttempt(client, learner, id)).rejects.toThrow(
          'NOT_FOUND'
        );
        await expect(listEvaluations(client, learner, id)).rejects.toThrow(
          'NOT_FOUND'
        );
      }
    }
  });

  it('attempts against a foreign study session write nothing', async () => {
    const before = await privateState(client);
    for (const studySessionId of guessed) {
      await expect(
        recordAttempt(client, ownerA, {
          studySessionId,
          questionId: 'question-1',
          submissionKey: `forged:${studySessionId}`,
          evidenceKind: 'independent',
          answer: 'un'
        })
      ).rejects.toThrow(/NOT_FOUND|INVALID_/);
    }
    // A forged question id in the caller's own session is also not found.
    await expect(
      recordAttempt(client, ownerA, {
        studySessionId: 'study-a',
        questionId: 'question-missing',
        submissionKey: 'forged:question',
        evidenceKind: 'independent',
        answer: 'un'
      })
    ).rejects.toThrow('NOT_FOUND');
    expect(await privateState(client)).toEqual(before);
  });

  it.each(['practice', 'mixed-review'])(
    'holdouts cannot create attempts in %s',
    async (mode) => {
      await client.execute(
        "UPDATE questions SET holdout = 1 WHERE id = 'question-1'"
      );
      await client.execute({
        sql: "UPDATE study_sessions SET mode = ? WHERE id = 'study-a'",
        args: [mode]
      });
      const before = await privateState(client);
      await expect(
        recordAttempt(client, ownerA, {
          studySessionId: 'study-a',
          questionId: 'question-1',
          submissionKey: 'holdout',
          evidenceKind: 'independent',
          answer: 'un'
        })
      ).rejects.toThrow('CONTENT_UNAVAILABLE');
      expect(await privateState(client)).toEqual(before);
    }
  );

  it('assessment can record a holdout with idempotent replay', async () => {
    await client.execute(
      "UPDATE questions SET holdout = 1 WHERE id = 'question-1'"
    );
    await client.execute(
      "UPDATE study_sessions SET mode = 'assessment' WHERE id = 'study-a'"
    );
    const input = {
      studySessionId: 'study-a',
      questionId: 'question-1',
      submissionKey: 'holdout',
      evidenceKind: 'independent' as const,
      answer: 'un'
    };
    const result = await recordAttempt(client, ownerA, input);
    expect(result.duplicate).toBe(false);
    expect(await recordAttempt(client, ownerA, input)).toEqual({
      id: result.id,
      duplicate: true
    });
  });

  it('a question from quarantined content records no attempt', async () => {
    await client.execute(
      "UPDATE content_versions SET status = 'quarantined' WHERE id = 'content-v1'"
    );
    const before = await privateState(client);
    await expect(
      recordAttempt(client, ownerA, {
        studySessionId: 'study-a',
        questionId: 'question-1',
        submissionKey: 'quarantined',
        evidenceKind: 'independent',
        answer: 'un'
      })
    ).rejects.toThrow('CONTENT_UNAVAILABLE');
    expect(await privateState(client)).toEqual(before);
  });

  it('decks, notes and cards of another owner cannot be read or changed', async () => {
    const before = await privateState(client);
    expect(await listDecks(client, ownerA)).toEqual([]);
    expect((await listDecks(client, ownerB)).map((deck) => deck.id)).toEqual([
      'deck-b'
    ]);
    for (const id of guessed) {
      await expect(getNote(client, ownerA, id)).rejects.toThrow('NOT_FOUND');
      await expect(approveNote(client, ownerA, id)).rejects.toThrow(
        'NOT_FOUND'
      );
      await expect(
        createNote(client, ownerA, {
          id: `note-forged-${guessed.indexOf(id)}`,
          sourceId: testSourceId(`f${guessed.indexOf(id)}`),
          deckId: id,
          kind: 'basic',
          content: { front: 'x', back: 'y' }
        })
      ).rejects.toThrow(/NOT_FOUND|INVALID_NOTE/);
    }
    expect(await privateState(client)).toEqual(before);
  });

  it('FSRS snapshots and immutable review events of another owner are untouched', async () => {
    const before = await privateState(client);
    for (const cardId of guessed) {
      await expect(
        submitReview(client, ownerA, {
          cardId,
          submissionId: `forged:${cardId}`,
          expectedRevision: 1,
          rating: 'easy'
        })
      ).rejects.toThrow('NOT_FOUND');
      await expect(listReviewEvents(client, ownerA, cardId)).rejects.toThrow(
        'NOT_FOUND'
      );
    }
    // Reusing B's submission id must not replay B's review event for A.
    await expect(
      submitReview(client, ownerA, {
        cardId: 'card:note-b',
        submissionId: 'review-b',
        expectedRevision: 0,
        rating: 'good'
      })
    ).rejects.toThrow('NOT_FOUND');
    expect(await privateState(client)).toEqual(before);
    const events = await listReviewEvents(client, ownerB, 'card:note-b');
    expect(events).toMatchObject([
      { id: 'review-b', expectedRevision: 0, rating: 'good' }
    ]);
    expect(events[0]).not.toHaveProperty('ownerId');
  });
});
