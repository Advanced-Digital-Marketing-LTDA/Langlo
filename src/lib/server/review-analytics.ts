import type { Client } from '@libsql/client';
import { getTimezone } from './preferences';
import type { LearnerSession } from './learner-session';
import type { TrackProgress } from './progress';
import { studyDayStart } from './study-days';

export type ReviewDueDay = {
  date: string;
  grammar: number;
  flashcards: number;
  total: number;
};

function localDate(date: Date, timezone: string): string {
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

function dayIndex(timestamp: number, boundaries: Date[]): number {
  for (let index = 0; index < 7; index += 1) {
    if (timestamp < boundaries[index + 1].getTime()) return index;
  }
  return -1;
}

export async function loadReviewDueByDay(
  client: Pick<Client, 'execute'>,
  learner: LearnerSession,
  tracks: TrackProgress[],
  now = new Date()
): Promise<ReviewDueDay[]> {
  const timezone = (await getTimezone(client, learner)) ?? 'UTC';
  const boundaries = Array.from({ length: 8 }, (_, index) =>
    studyDayStart(now, timezone, index)
  );
  const counts = Array.from({ length: 7 }, () => ({
    grammar: 0,
    flashcards: 0
  }));

  for (const track of tracks) {
    for (const skill of track.skills) {
      const dueAt = skill.retention.dueAt;
      if (!skill.available || dueAt === null || !Number.isFinite(dueAt))
        continue;
      const index = dayIndex(dueAt, boundaries);
      if (index >= 0) counts[index].grammar += 1;
    }
  }

  const dueCards = await client.execute({
    sql: `SELECT CASE ${boundaries
      .slice(1)
      .map((_, index) => `WHEN c.due_at < ? THEN ${index}`)
      .join(' ')} ELSE NULL END AS day, count(*) AS total
      FROM native_flashcards c
      JOIN native_flashcard_notes n ON n.id = c.note_id AND n.owner_id = c.owner_id
      WHERE c.owner_id = ? AND c.suspended = 0 AND n.status = 'approved' AND c.due_at < ?
      GROUP BY day`,
    args: [
      ...boundaries.slice(1).map((boundary) => boundary.getTime()),
      learner.userId,
      boundaries[7].getTime()
    ]
  });
  for (const row of dueCards.rows) {
    const index = Number(row.day);
    if (index >= 0 && index < 7) counts[index].flashcards = Number(row.total);
  }

  return counts.map((count, index) => ({
    date: localDate(boundaries[index], timezone),
    ...count,
    total: count.grammar + count.flashcards
  }));
}
