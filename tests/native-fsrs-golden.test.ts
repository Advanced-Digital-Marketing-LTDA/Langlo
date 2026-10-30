import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '@libsql/client';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { listDueCards } from '../src/lib/server/flashcard-views';
import {
  approveNote,
  createNote,
  getNote,
  listReviewEvents,
  submitReview,
  type LearnerSession
} from '../src/lib/server/flashcards';
import { createDeck } from './fixtures/french-deck';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession,
  testSourceId
} from './fixtures/flashcards';

// LANGLO-117: a fixed-time golden schedule for every rating. Fuzz stays on,
// as the owner chose, and is seeded by card ID, so fixed IDs and a fixed
// clock make the schedule deterministic.

const approvedAt = new Date('2026-03-02T08:00:00.000Z');
const reviewedAt = new Date('2026-03-02T09:00:00.000Z');
const ratings = ['again', 'hard', 'good', 'easy'] as const;
type RatingName = (typeof ratings)[number];

const identity = (index: number) =>
  `30000000-0000-4000-8000-00000000000${index}`;
const noteId = (index: number) => `note-${identity(index)}`;
const cardId = (index: number) => `card:${noteId(index)}`;
const submissionId = (index: number) =>
  `40000000-0000-4000-8000-00000000000${index}`;

// The preview each button shows matches the schedule that was stored.
const golden = {
  again: {
    preview: '1m',
    dueAt: '2026-03-02T09:01:00.000Z',
    state: 1,
    scheduledDays: 0,
    learningSteps: 0,
    stability: 0.212,
    difficulty: 6.4133
  },
  hard: {
    preview: '6m',
    dueAt: '2026-03-02T09:06:00.000Z',
    state: 1,
    scheduledDays: 0,
    learningSteps: 0,
    stability: 1.2931,
    difficulty: 5.1122
  },
  good: {
    preview: '10m',
    dueAt: '2026-03-02T09:10:00.000Z',
    state: 1,
    scheduledDays: 0,
    learningSteps: 1,
    stability: 2.3065,
    difficulty: 2.1181
  },
  easy: {
    preview: '10d',
    dueAt: '2026-03-12T04:00:00.000Z',
    state: 2,
    scheduledDays: 10,
    learningSteps: 0,
    stability: 8.2956,
    difficulty: 1
  }
};

/** Approve one new card per rating at the fixed approval time. */
async function approveNewCards(client: Client, learner: LearnerSession) {
  vi.setSystemTime(approvedAt);
  await createDeck(client, learner, {
    id: 'deck-30000000-0000-4000-8000-000000000001',
    name: 'Golden'
  });
  for (const index of ratings.keys()) {
    await createNote(client, learner, {
      id: noteId(index),
      sourceId: testSourceId(identity(index)),
      deckId: 'deck-30000000-0000-4000-8000-000000000001',
      kind: 'basic',
      content: { front: `Front ${index}`, back: `Back ${index}` }
    });
    await approveNote(client, learner, noteId(index));
    const card = (await getNote(client, learner, noteId(index))).card!;
    // An approved new card starts from an empty scheduler state.
    expect(card.state).toMatchObject({ reps: 0, lapses: 0, state: 0 });
  }
}

/** Rate one card and return what was stored, checking only one event exists. */
async function rateAndRead(
  client: Client,
  learner: LearnerSession,
  index: number,
  rating: RatingName
) {
  const result = await submitReview(client, learner, {
    cardId: cardId(index),
    submissionId: submissionId(index),
    expectedRevision: 0,
    rating
  });
  const events = await listReviewEvents(client, learner, cardId(index));
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    rating,
    reviewedAt: reviewedAt.getTime()
  });
  const stored = await client.execute({
    sql: 'SELECT scheduler_version, parameters_json FROM native_flashcard_review_events WHERE id = ?',
    args: [submissionId(index)]
  });
  expect(stored.rows[0].scheduler_version).toBe('ts-fsrs@5.4.2');
  expect(JSON.parse(String(stored.rows[0].parameters_json))).toMatchObject({
    request_retention: 0.9,
    enable_fuzz: true,
    learning_steps: ['1m', '10m'],
    relearning_steps: ['10m']
  });
  const state = events[0].state!;
  return {
    dueAt: new Date(result.dueAt).toISOString(),
    state: state.state,
    scheduledDays: state.scheduled_days,
    learningSteps: state.learning_steps,
    stability: Number(state.stability.toFixed(4)),
    difficulty: Number(state.difficulty.toFixed(4))
  };
}

afterEach(async () => {
  vi.useRealTimers();
  await disposeFlashcardFixtures();
});

describe('native FSRS golden schedule', () => {
  it('schedules each rating from a new card to a fixed due time', async () => {
    const learner = testSession('learner-a');
    const db = await openFixtureDatabase(await fixture());
    try {
      vi.useFakeTimers({ toFake: ['Date'] });
      await approveNewCards(db.client, learner);

      vi.setSystemTime(reviewedAt);
      const due = await listDueCards(db.client, learner, reviewedAt.getTime());
      const previews = new Map(
        due.cards.map((card) => [card.id, card.intervals])
      );
      expect(previews.size).toBe(ratings.length);

      const outcomes: Record<string, unknown> = {};
      for (const [index, rating] of ratings.entries()) {
        const preview = previews.get(cardId(index))!;
        expect(Object.keys(preview).sort()).toEqual([...ratings].sort());
        outcomes[rating] = {
          preview: preview[rating],
          ...(await rateAndRead(db.client, learner, index, rating))
        };
      }
      expect(outcomes).toEqual(golden);
    } finally {
      db.close();
    }
  });
});
