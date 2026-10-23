import { createClient } from '@libsql/client';
import { expect, it } from 'vitest';
import {
  loadReviewAnalytics,
  loadReviewCounts,
  reviewAnalyticsDays
} from '../src/lib/server/review-analytics';
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
  {
    length,
    firstDayOffset = -365
  }: { length: number; firstDayOffset?: number },
  overrides: Record<number, Partial<Day>>
): Day[] {
  return Array.from({ length }, (_, index) => ({
    date: localDate(
      studyDayStart(now, timezone, index + firstDayOffset),
      timezone
    ),
    flashcardsCompleted: index + firstDayOffset <= 0 ? 0 : null,
    grammarCompleted: index + firstDayOffset <= 0 ? 0 : null,
    flashcardsScheduled: index + firstDayOffset >= 0 ? 0 : null,
    grammarScheduled: index + firstDayOffset >= 0 ? 0 : null,
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
      expectedDays(
        now,
        timezone,
        { length: 366 },
        {
          0: { flashcardsCompleted: 1, grammarCompleted: 1 },
          365: { flashcardsCompleted: 2, grammarCompleted: 1 }
        }
      )
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
      expectedDays(
        now,
        timezone,
        { length: 31, firstDayOffset: 0 },
        {
          0: { flashcardsScheduled: 2, grammarScheduled: 2 },
          1: { flashcardsScheduled: 1, grammarScheduled: 1 },
          30: { flashcardsScheduled: 1, grammarScheduled: 1 }
        }
      )
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
      expectedDays(
        now,
        timezone,
        { length: 366, firstDayOffset: 0 },
        {
          365: { flashcardsScheduled: 1, grammarScheduled: 1 }
        }
      )
    );
  } finally {
    client.close();
  }
});

it.each([
  'native_flashcard_review_events',
  'grammar_retention_events'
] as const)(
  'starts at the first retained %s review and keeps zero days within the range',
  async (table) => {
    const timezone = 'America/Sao_Paulo';
    const now = new Date('2026-10-22T12:00:00.000Z');
    const firstDay = studyDayStart(now, timezone, -30);
    const lastDay = studyDayStart(now, timezone, 30);
    const client = await analyticsClient();
    try {
      await addEvent(client, table, 'learner-a', firstDay.getTime());
      await addEvent(
        client,
        table,
        'learner-a',
        studyDayStart(now, timezone, -366).getTime()
      );
      await addEvent(
        client,
        table,
        'learner-b',
        studyDayStart(now, timezone, -90).getTime()
      );
      await addCard(client, { noteId: 'last-due', dueAt: lastDay.getTime() });

      const days = await loadReviewAnalytics(
        client,
        { userId: 'learner-a' },
        [],
        now
      );

      expect(days).toHaveLength(61);
      expect(days[0].date).toBe(localDate(firstDay, timezone));
      expect(days[1]).toMatchObject({
        flashcardsCompleted: 0,
        grammarCompleted: 0,
        flashcardsScheduled: null,
        grammarScheduled: null
      });
      expect(days[30].date).toBe('2026-10-22');
      expect(days.at(-1)).toMatchObject({
        date: localDate(lastDay, timezone),
        flashcardsScheduled: 1
      });
    } finally {
      client.close();
    }
  }
);

it('shows only today when there are no retained reviews or scheduled work', async () => {
  const client = await analyticsClient();
  try {
    expect(
      await loadReviewAnalytics(
        client,
        { userId: 'learner-a' },
        [],
        new Date('2026-10-22T12:00:00.000Z')
      )
    ).toEqual([
      {
        date: '2026-10-22',
        flashcardsCompleted: 0,
        grammarCompleted: 0,
        flashcardsScheduled: 0,
        grammarScheduled: 0
      }
    ]);
  } finally {
    client.close();
  }
});

it('counts reviews in the timezone it is given, not the stored one', async () => {
  const client = await analyticsClient();
  try {
    // 05:00 UTC is today's study day in UTC (from 04:00) but yesterday's in
    // the stored America/Sao_Paulo (from 07:00 UTC).
    const reviewedAt = new Date('2026-10-22T05:00:00.000Z').getTime();
    await addEvent(client, 'grammar_retention_events', 'learner-a', reviewedAt);
    await addEvent(client, 'grammar_retention_events', 'learner-b', reviewedAt);
    await addCard(client, {
      noteId: 'due-tomorrow',
      dueAt: studyDayStart(now, 'UTC', 1).getTime()
    });

    const counts = await loadReviewCounts(
      client,
      { userId: 'learner-a' },
      'UTC',
      now.getTime()
    );

    expect(counts.timezone).toBe('UTC');
    expect(counts.boundaries[365]).toEqual(studyDayStart(now, 'UTC', 0));
    expect(counts.grammarCompleted[365]).toBe(1);
    expect(counts.grammarCompleted[364]).toBe(0);
    expect(counts.flashcardsScheduled[366]).toBe(1);
    expect(reviewAnalyticsDays(counts, [])).toEqual(
      expectedDays(
        now,
        'UTC',
        { length: 2, firstDayOffset: 0 },
        { 0: { grammarCompleted: 1 }, 1: { flashcardsScheduled: 1 } }
      )
    );
  } finally {
    client.close();
  }
});
