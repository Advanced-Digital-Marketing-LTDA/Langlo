import { createClient } from '@libsql/client';
import { expect, it } from 'vitest';
import { loadReviewDueByDay } from '../src/lib/server/review-analytics';
import { studyDayStart } from '../src/lib/server/study-days';

async function seedReviewAnalyticsDatabase(
  client: ReturnType<typeof createClient>,
  timezone: string,
  boundaries: Date[]
) {
  const dueCards = [
    ['note-1', boundaries[0].getTime() - 1],
    ['note-2', boundaries[0].getTime()],
    ['note-3', boundaries[2].getTime()]
  ];
  await client.batch([
    'CREATE TABLE learner_preferences (owner_id TEXT PRIMARY KEY, timezone TEXT)',
    'CREATE TABLE native_flashcard_notes (id TEXT, owner_id TEXT, status TEXT)',
    'CREATE TABLE native_flashcards (owner_id TEXT, note_id TEXT, due_at INTEGER, suspended INTEGER)',
    {
      sql: 'INSERT INTO learner_preferences VALUES (?, ?)',
      args: ['learner-a', timezone]
    },
    ...dueCards.flatMap(([id, dueAt]) => [
      {
        sql: 'INSERT INTO native_flashcard_notes VALUES (?, ?, ?)',
        args: [id, 'learner-a', 'approved']
      },
      {
        sql: 'INSERT INTO native_flashcards VALUES (?, ?, ?, 0)',
        args: ['learner-a', id, dueAt]
      }
    ])
  ]);
}

it('counts grammar schedules and SQLite flashcards by local study day', async () => {
  const timezone = 'America/Sao_Paulo';
  const now = new Date('2026-10-22T12:00:00.000Z');
  const boundaries = Array.from({ length: 8 }, (_, index) =>
    studyDayStart(now, timezone, index)
  );
  const client = createClient({ url: ':memory:' });
  try {
    await seedReviewAnalyticsDatabase(client, timezone, boundaries);
    const tracks = [
      {
        skills: [
          {
            available: true,
            retention: { dueAt: boundaries[0].getTime() - 1 }
          },
          { available: true, retention: { dueAt: boundaries[0].getTime() } },
          { available: true, retention: { dueAt: boundaries[1].getTime() } },
          { available: true, retention: { dueAt: boundaries[7].getTime() } },
          { available: false, retention: { dueAt: boundaries[0].getTime() } },
          { available: true, retention: { dueAt: null } }
        ]
      }
    ];
    const days = await loadReviewDueByDay(
      client,
      { userId: 'learner-a' },
      tracks,
      now
    );

    expect(days).toEqual([
      { date: '2026-10-22', grammar: 2, flashcards: 2, total: 4 },
      { date: '2026-10-23', grammar: 1, flashcards: 0, total: 1 },
      { date: '2026-10-24', grammar: 0, flashcards: 1, total: 1 },
      { date: '2026-10-25', grammar: 0, flashcards: 0, total: 0 },
      { date: '2026-10-26', grammar: 0, flashcards: 0, total: 0 },
      { date: '2026-10-27', grammar: 0, flashcards: 0, total: 0 },
      { date: '2026-10-28', grammar: 0, flashcards: 0, total: 0 }
    ]);
  } finally {
    client.close();
  }
});
