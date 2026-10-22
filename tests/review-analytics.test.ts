import { expect, it, vi } from 'vitest';
import type { Client } from '@libsql/client';
import { loadReviewDueByDay } from '../src/lib/server/review-analytics';
import type { TrackProgress } from '../src/lib/server/progress';
import { studyDayStart } from '../src/lib/server/study-days';

it('counts available scheduled grammar skills over seven local study days', async () => {
  const timezone = 'America/Sao_Paulo';
  const now = new Date('2026-10-22T12:00:00.000Z');
  const boundaries = Array.from({ length: 8 }, (_, index) =>
    studyDayStart(now, timezone, index)
  );
  const client = {
    execute: vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ timezone }] })
      .mockResolvedValueOnce({
        rows: [
          { day: 0, total: 2 },
          { day: 2, total: 1 }
        ]
      })
  } as unknown as Pick<Client, 'execute'>;
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
  ] as unknown as TrackProgress[];

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
});
