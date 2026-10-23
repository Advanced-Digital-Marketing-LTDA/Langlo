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

async function addCard(
  client: ReturnType<typeof createClient>,
  noteId: string,
  ownerId: string,
  status: string,
  dueAt: number,
  suspended = 0
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

it('separates completed history from current due work by study day', async () => {
  const timezone = 'America/Sao_Paulo';
  const now = new Date('2026-10-22T12:00:00.000Z');
  const start = studyDayStart(now, timezone, -365).getTime();
  const today = studyDayStart(now, timezone).getTime();
  const tomorrow = studyDayStart(now, timezone, 1).getTime();
  const farDay = studyDayStart(now, timezone, 30).getTime();
  const beyondCap = studyDayStart(now, timezone, 366).getTime();
  const client = await analyticsClient();
  try {
    await addCard(client, 'overdue', 'learner-a', 'approved', today - 1);
    await addCard(client, 'due-today', 'learner-a', 'approved', today);
    await addCard(client, 'due-tomorrow', 'learner-a', 'approved', tomorrow);
    await addCard(client, 'due-far', 'learner-a', 'approved', farDay);
    await addCard(client, 'beyond-cap', 'learner-a', 'approved', beyondCap);
    await addCard(client, 'other-owner', 'learner-b', 'approved', tomorrow);
    await addCard(client, 'suspended', 'learner-a', 'approved', tomorrow, 1);
    await addCard(client, 'rejected', 'learner-a', 'rejected', tomorrow);
    await addEvent(
      client,
      'native_flashcard_review_events',
      'learner-a',
      start
    );
    await addEvent(client, 'grammar_retention_events', 'learner-a', start);
    await addEvent(
      client,
      'native_flashcard_review_events',
      'learner-a',
      start - 1
    );
    await addEvent(client, 'grammar_retention_events', 'learner-a', start - 1);
    await addEvent(
      client,
      'native_flashcard_review_events',
      'learner-a',
      now.getTime() - 1000,
      2
    );
    await addEvent(
      client,
      'grammar_retention_events',
      'learner-a',
      now.getTime() - 1000
    );
    await addEvent(
      client,
      'native_flashcard_review_events',
      'learner-a',
      now.getTime() + 1000
    );
    await addEvent(
      client,
      'grammar_retention_events',
      'learner-b',
      now.getTime() - 1000
    );

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

    expect(days).toHaveLength(396);
    expect(days[0]).toEqual({
      date: localDate(new Date(start), timezone),
      flashcardsCompleted: 1,
      grammarCompleted: 1,
      flashcardsScheduled: null,
      grammarScheduled: null
    });
    expect(days[365]).toMatchObject({
      date: localDate(new Date(today), timezone),
      flashcardsCompleted: 2,
      grammarCompleted: 1,
      flashcardsScheduled: 2,
      grammarScheduled: 2
    });
    expect(days[366]).toMatchObject({
      date: localDate(new Date(tomorrow), timezone),
      flashcardsCompleted: null,
      grammarCompleted: null,
      flashcardsScheduled: 1,
      grammarScheduled: 1
    });
    expect(days.at(-1)).toMatchObject({
      date: localDate(new Date(farDay), timezone),
      flashcardsScheduled: 1,
      grammarScheduled: 1
    });
  } finally {
    client.close();
  }
});

it('ends at the farthest due day, capped at 365 study days ahead', async () => {
  const timezone = 'America/Sao_Paulo';
  const now = new Date('2026-10-22T12:00:00.000Z');
  const finalDay = studyDayStart(now, timezone, 365);
  const beyondCap = studyDayStart(now, timezone, 366);
  const client = await analyticsClient();
  try {
    await addCard(
      client,
      'last-day',
      'learner-a',
      'approved',
      finalDay.getTime()
    );
    await addCard(
      client,
      'too-far',
      'learner-a',
      'approved',
      beyondCap.getTime()
    );
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

    expect(days).toHaveLength(731);
    expect(days.at(-1)).toMatchObject({
      date: localDate(finalDay, timezone),
      flashcardsScheduled: 1,
      grammarScheduled: 1
    });
  } finally {
    client.close();
  }
});
