import { createClient } from '@libsql/client';
import { expect, it } from 'vitest';
import { loadReviewDueByDay } from '../src/lib/server/review-analytics';
import { studyDayStart } from '../src/lib/server/study-days';

it('counts grammar schedules and SQLite flashcards by local study day', async () => {
  const timezone = 'America/Sao_Paulo';
  const now = new Date('2026-10-22T12:00:00.000Z');
  const boundaries = Array.from({ length: 8 }, (_, index) =>
    studyDayStart(now, timezone, index)
  );
  const client = createClient({ url: ':memory:' });
  await client.batch([
    'CREATE TABLE learner_preferences (owner_id TEXT PRIMARY KEY, timezone TEXT)',
    'CREATE TABLE native_flashcard_notes (id TEXT, owner_id TEXT, status TEXT)',
    'CREATE TABLE native_flashcards (owner_id TEXT, note_id TEXT, due_at INTEGER, suspended INTEGER)',
    {
      sql: 'INSERT INTO learner_preferences VALUES (?, ?)',
      args: ['learner-a', timezone]
    },
    {
      sql: 'INSERT INTO native_flashcard_notes VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)',
      args: [
        'note-1',
        'learner-a',
        'approved',
        'note-2',
        'learner-a',
        'approved',
        'note-3',
        'learner-a',
        'approved'
      ]
    },
    {
      sql: 'INSERT INTO native_flashcards VALUES (?, ?, ?, 0), (?, ?, ?, 0), (?, ?, ?, 0)',
      args: [
        'learner-a',
        'note-1',
        boundaries[0].getTime() - 1,
        'learner-a',
        'note-2',
        boundaries[0].getTime(),
        'learner-a',
        'note-3',
        boundaries[2].getTime()
      ]
    }
  ]);
  const tracks = [
    {
      skills: [
        { available: true, retention: { dueAt: boundaries[0].getTime() - 1 } },
        { available: true, retention: { dueAt: boundaries[0].getTime() } },
        { available: true, retention: { dueAt: boundaries[1].getTime() } },
        { available: true, retention: { dueAt: boundaries[7].getTime() } },
        { available: false, retention: { dueAt: boundaries[0].getTime() } },
        { available: true, retention: { dueAt: null } }
      ]
    }
  ];
  try {
    const days = await loadReviewDueByDay(
      client,
      { userId: 'learner-a' },
      tracks,
      now
    );

    expect(days).toHaveLength(7);
    expect(days.map(({ date }) => date)).toEqual([
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28'
    ]);
    expect(
      days.map(({ grammar, flashcards, total }) => [grammar, flashcards, total])
    ).toEqual([
      [2, 2, 4],
      [1, 0, 1],
      [0, 1, 1],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ]);
  } finally {
    client.close();
  }
});
