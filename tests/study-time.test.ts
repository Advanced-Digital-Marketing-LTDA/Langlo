import { createClient } from '@libsql/client';
import { expect, it } from 'vitest';
import { loadStudyTime, recordStudyTime } from '../src/lib/server/study-time';
import { StudyError } from '../src/lib/server/study-error';
import { studyDayStart } from '../src/lib/server/study-days';

async function studyClient(timezone: string | null) {
  const client = createClient({ url: ':memory:' });
  await client.batch([
    'CREATE TABLE learner_preferences (owner_id TEXT PRIMARY KEY, timezone TEXT)',
    'CREATE TABLE study_time_segments (id TEXT, owner_id TEXT, category TEXT, started_at INTEGER, ended_at INTEGER, PRIMARY KEY (owner_id, id))'
  ]);
  if (timezone)
    await client.execute({
      sql: 'INSERT INTO learner_preferences VALUES (?, ?)',
      args: ['learner-a', timezone]
    });
  return client;
}

const now = new Date('2026-10-22T12:00:00.000Z').getTime();
const learner = { userId: 'learner-a' };
const minute = 60_000;

function segment(
  id: string,
  category: string,
  startedAt: number,
  endedAt: number
) {
  return { id, category, startedAt, endedAt };
}

it('splits study time by category and study day in the learner timezone', async () => {
  const timezone = 'America/Sao_Paulo';
  const client = await studyClient(timezone);
  const today = studyDayStart(new Date(now), timezone).getTime();
  try {
    await recordStudyTime(
      client,
      learner,
      segment('a', 'flashcards', today + minute, today + 3 * minute),
      now
    );
    await recordStudyTime(
      client,
      learner,
      segment('b', 'grammar', today + 5 * minute, today + 6 * minute),
      now
    );
    // Crosses the 4am boundary: one minute yesterday, one minute today.
    await recordStudyTime(
      client,
      learner,
      segment('c', 'grammar', today - minute, today + minute),
      now
    );

    const days = await loadStudyTime(client, learner, '2026-10-20', now);

    expect(days).toEqual([
      { date: '2026-10-20', flashcardsSeconds: null, grammarSeconds: null },
      { date: '2026-10-21', flashcardsSeconds: 0, grammarSeconds: 60 },
      { date: '2026-10-22', flashcardsSeconds: 120, grammarSeconds: 120 }
    ]);
  } finally {
    client.close();
  }
});

it('uses UTC study days when the learner has no timezone', async () => {
  const client = await studyClient(null);
  try {
    // 03:59 UTC on 22 October belongs to the 21 October study day.
    const beforeBoundary = Date.parse('2026-10-22T03:58:00.000Z');
    await recordStudyTime(
      client,
      learner,
      segment('a', 'flashcards', beforeBoundary, beforeBoundary + minute),
      now
    );

    expect(await loadStudyTime(client, learner, '2026-10-22', now)).toEqual([
      { date: '2026-10-21', flashcardsSeconds: 60, grammarSeconds: 0 },
      { date: '2026-10-22', flashcardsSeconds: null, grammarSeconds: null }
    ]);
  } finally {
    client.close();
  }
});

it('shows only the caller own study time', async () => {
  const client = await studyClient('UTC');
  try {
    await recordStudyTime(
      client,
      { userId: 'learner-b' },
      segment('b', 'grammar', now - 2 * minute, now - minute),
      now
    );

    expect(await loadStudyTime(client, learner, '2026-10-22', now)).toEqual([
      { date: '2026-10-22', flashcardsSeconds: null, grammarSeconds: null }
    ]);
    const rows = await client.execute(
      'SELECT owner_id FROM study_time_segments'
    );
    expect(rows.rows.map((row) => row.owner_id)).toEqual(['learner-b']);
  } finally {
    client.close();
  }
});

it('rejects malformed study time without saving it', async () => {
  const client = await studyClient('UTC');
  const invalid = [
    segment('', 'grammar', now - minute, now),
    segment('a', 'reading', now - minute, now),
    segment('a', 'grammar', now, now),
    segment('a', 'grammar', now - 25 * 60 * minute, now),
    segment('a', 'grammar', now, now + 2 * minute),
    segment(
      'a',
      'grammar',
      now - 8 * 24 * 60 * minute,
      now - 8 * 24 * 60 * minute + minute
    ),
    { id: 'a', category: 'grammar', startedAt: '1', endedAt: now }
  ];
  try {
    for (const body of invalid)
      await expect(recordStudyTime(client, learner, body, now)).rejects.toEqual(
        new StudyError('INVALID_STUDY_TIME')
      );
    expect(
      (
        await client.execute(
          'SELECT count(*) AS total FROM study_time_segments'
        )
      ).rows[0].total
    ).toBe(0);
  } finally {
    client.close();
  }
});

it('accepts a segment ending up to a minute after the server clock and rejects one later', async () => {
  const client = await studyClient('UTC');
  try {
    await expect(
      recordStudyTime(
        client,
        learner,
        segment('a', 'grammar', now - minute, now + minute),
        now
      )
    ).resolves.toEqual({ saved: true });
    await expect(
      recordStudyTime(
        client,
        learner,
        segment('b', 'grammar', now - minute, now + minute + 1),
        now
      )
    ).rejects.toEqual(new StudyError('INVALID_STUDY_TIME'));
  } finally {
    client.close();
  }
});

it('accepts each limit exactly and rejects one millisecond or character past it', async () => {
  const client = await studyClient('UTC');
  const day = 24 * 60 * minute;
  const week = 7 * day;
  const accepted = [
    segment('longest', 'grammar', now - day, now),
    segment('oldest', 'grammar', now - week, now - week + minute),
    segment('x'.repeat(64), 'flashcards', now - minute, now)
  ];
  const rejected = [
    segment('too-long', 'grammar', now - day - 1, now),
    segment('too-old', 'grammar', now - week - 1, now - week + minute),
    segment('x'.repeat(65), 'flashcards', now - minute, now),
    { id: 'fraction', category: 'grammar', startedAt: now - 1.5, endedAt: now }
  ];
  try {
    for (const body of accepted)
      await expect(
        recordStudyTime(client, learner, body, now)
      ).resolves.toEqual({ saved: true });
    for (const body of rejected)
      await expect(recordStudyTime(client, learner, body, now)).rejects.toEqual(
        new StudyError('INVALID_STUDY_TIME')
      );
    expect(
      (
        await client.execute(
          'SELECT count(*) AS total FROM study_time_segments'
        )
      ).rows[0].total
    ).toBe(3);
  } finally {
    client.close();
  }
});

it('counts overlapping segments of one category once', async () => {
  const client = await studyClient('UTC');
  try {
    // Two lesson tabs: 10 and 5 minutes overlapping by 3, then a flashcard
    // segment over the same time, which is a different category.
    await recordStudyTime(
      client,
      learner,
      segment('a', 'grammar', now - 20 * minute, now - 10 * minute),
      now
    );
    await recordStudyTime(
      client,
      learner,
      segment('b', 'grammar', now - 13 * minute, now - 8 * minute),
      now
    );
    await recordStudyTime(
      client,
      learner,
      segment('c', 'flashcards', now - 20 * minute, now - 18 * minute),
      now
    );

    expect(await loadStudyTime(client, learner, '2026-10-22', now)).toEqual([
      { date: '2026-10-22', flashcardsSeconds: 120, grammarSeconds: 720 }
    ]);
  } finally {
    client.close();
  }
});
