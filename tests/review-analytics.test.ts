import { createClient } from '@libsql/client';
import { expect, it } from 'vitest';
import { loadReviewAnalytics } from '../src/lib/server/review-analytics';
import { studyDayStart } from '../src/lib/server/study-days';

async function analyticsClient() {
  const client = createClient({ url: ':memory:' });
  await client.batch([
    'CREATE TABLE learner_preferences (owner_id TEXT PRIMARY KEY, timezone TEXT)',
    'CREATE TABLE native_flashcard_notes (id TEXT, owner_id TEXT, status TEXT)',
    'CREATE TABLE native_flashcards (owner_id TEXT, note_id TEXT, due_at INTEGER, suspended INTEGER)',
    'CREATE TABLE native_flashcard_review_events (owner_id TEXT, reviewed_at INTEGER)',
    'CREATE TABLE grammar_retention_events (owner_id TEXT, reviewed_at INTEGER)',
    {
      sql: 'INSERT INTO learner_preferences VALUES (?, ?)',
      args: ['learner-a', 'America/Sao_Paulo']
    }
  ]);
  return client;
}

type CardSeed = {
  noteId: string;
  dueAt: number;
  ownerId?: string;
  status?: string;
  suspended?: number;
};

async function addCard(
  client: ReturnType<typeof createClient>,
  {
    noteId,
    dueAt,
    ownerId = 'learner-a',
    status = 'approved',
    suspended = 0
  }: CardSeed
) {
  await client.batch([
    {
      sql: 'INSERT INTO native_flashcard_notes VALUES (?, ?, ?)',
      args: [noteId, ownerId, status]
    },
    {
      sql: 'INSERT INTO native_flashcards VALUES (?, ?, ?, ?)',
      args: [ownerId, noteId, dueAt, suspended]
    }
  ]);
}

async function addEvent(
  client: ReturnType<typeof createClient>,
  table: 'native_flashcard_review_events' | 'grammar_retention_events',
  ownerId: string,
  reviewedAt: number,
  count = 1
) {
  for (let index = 0; index < count; index += 1)
    await client.execute({
      sql: `INSERT INTO ${table} VALUES (?, ?)`,
      args: [ownerId, reviewedAt]
    });
}

function localDate(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}

type Day = Awaited<ReturnType<typeof loadReviewAnalytics>>[number];

// The whole expected window: zero completed reviews up to today, zero scheduled from today on,
// blank elsewhere, with `overrides` replacing the fields of the listed day indexes.
function expectedDays(
  now: Date,
  timezone: string,
  length: number,
  overrides: Record<number, Partial<Day>>
): Day[] {
  return Array.from({ length }, (_, index) => ({
    date: localDate(studyDayStart(now, timezone, index - 365), timezone),
    flashcardsCompleted: index <= 365 ? 0 : null,
    grammarCompleted: index <= 365 ? 0 : null,
    flashcardsScheduled: index >= 365 ? 0 : null,
    grammarScheduled: index >= 365 ? 0 : null,
    ...overrides[index]
  }));
}

const timezone = 'America/Sao_Paulo';
const now = new Date('2026-10-22T12:00:00.000Z');

it('counts completed reviews by owner and study day across the last 365 days', async () => {
  const start = studyDayStart(now, timezone, -365).getTime();
  const client = await analyticsClient();
  try {
    const flashcards = 'native_flashcard_review_events';
    const grammar = 'grammar_retention_events';
    await addEvent(client, flashcards, 'learner-a', start);
    await addEvent(client, grammar, 'learner-a', start);
    await addEvent(client, flashcards, 'learner-a', start - 1);
    await addEvent(client, grammar, 'learner-a', start - 1);
    await addEvent(client, flashcards, 'learner-a', now.getTime() - 1000, 2);
    await addEvent(client, grammar, 'learner-a', now.getTime() - 1000);
    await addEvent(client, flashcards, 'learner-a', now.getTime() + 1000);
    await addEvent(client, grammar, 'learner-b', now.getTime() - 1000);

    const days = await loadReviewAnalytics(
      client,
      { userId: 'learner-a' },
      [],
      now
    );

    expect(days).toEqual(
      expectedDays(now, timezone, 366, {
        0: { flashcardsCompleted: 1, grammarCompleted: 1 },
        365: { flashcardsCompleted: 2, grammarCompleted: 1 }
      })
    );
  } finally {
    client.close();
  }
});

it('counts current due work from today, including overdue work, by study day', async () => {
  const today = studyDayStart(now, timezone).getTime();
  const tomorrow = studyDayStart(now, timezone, 1).getTime();
  const farDay = studyDayStart(now, timezone, 30).getTime();
  const beyondCap = studyDayStart(now, timezone, 366).getTime();
  const client = await analyticsClient();
  try {
    for (const card of [
      { noteId: 'overdue', dueAt: today - 1 },
      { noteId: 'due-today', dueAt: today },
      { noteId: 'due-tomorrow', dueAt: tomorrow },
      { noteId: 'due-far', dueAt: farDay },
      { noteId: 'beyond-cap', dueAt: beyondCap },
      { noteId: 'other-owner', dueAt: tomorrow, ownerId: 'learner-b' },
      { noteId: 'suspended', dueAt: tomorrow, suspended: 1 },
      { noteId: 'rejected', dueAt: tomorrow, status: 'rejected' }
    ])
      await addCard(client, card);

    const days = await loadReviewAnalytics(
      client,
      { userId: 'learner-a' },
      [
        {
          skills: [
            { available: true, retention: { dueAt: today - 1 } },
            { available: true, retention: { dueAt: today } },
            { available: true, retention: { dueAt: tomorrow } },
            { available: true, retention: { dueAt: farDay } },
            { available: true, retention: { dueAt: beyondCap } },
            { available: false, retention: { dueAt: farDay } },
            { available: true, retention: { dueAt: null } }
          ]
        }
      ],
      now
    );

    expect(days).toEqual(
      expectedDays(now, timezone, 396, {
        365: { flashcardsScheduled: 2, grammarScheduled: 2 },
        366: { flashcardsScheduled: 1, grammarScheduled: 1 },
        395: { flashcardsScheduled: 1, grammarScheduled: 1 }
      })
    );
  } finally {
    client.close();
  }
});

it('ends at the farthest due day, capped at 365 study days ahead', async () => {
  const finalDay = studyDayStart(now, timezone, 365);
  const beyondCap = studyDayStart(now, timezone, 366);
  const client = await analyticsClient();
  try {
    await addCard(client, { noteId: 'last-day', dueAt: finalDay.getTime() });
    await addCard(client, { noteId: 'too-far', dueAt: beyondCap.getTime() });
    const days = await loadReviewAnalytics(
      client,
      { userId: 'learner-a' },
      [
        {
          skills: [
            { available: true, retention: { dueAt: finalDay.getTime() } },
            { available: true, retention: { dueAt: beyondCap.getTime() } }
          ]
        }
      ],
      now
    );

    expect(days).toEqual(
      expectedDays(now, timezone, 731, {
        730: { flashcardsScheduled: 1, grammarScheduled: 1 }
      })
    );
  } finally {
    client.close();
  }
});
