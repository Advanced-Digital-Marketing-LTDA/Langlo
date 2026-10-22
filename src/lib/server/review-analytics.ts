import type { Client } from '@libsql/client';
import { getTimezone } from './preferences';
import type { LearnerSession } from './learner-session';
import { studyDayStart } from './study-days';

export type ReviewDueDay = {
  date: string;
  grammar: number;
  flashcards: number;
  total: number;
};

type DueCounts = Pick<ReviewDueDay, 'grammar' | 'flashcards'>;
type GrammarTrack = {
  skills: { available: boolean; retention: { dueAt: number | null } }[];
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
  return boundaries
    .slice(1)
    .findIndex((boundary) => timestamp < boundary.getTime());
}

function studyDayBoundaries(now: Date, timezone: string): Date[] {
  return Array.from({ length: 8 }, (_, index) =>
    studyDayStart(now, timezone, index)
  );
}

function grammarDueCounts(
  tracks: GrammarTrack[],
  boundaries: Date[]
): DueCounts[] {
  const counts = Array.from({ length: 7 }, () => ({
    grammar: 0,
    flashcards: 0
  }));
  for (const track of tracks) {
    for (const skill of track.skills) {
      if (!skill.available) continue;
      const dueAt = skill.retention.dueAt;
      if (dueAt === null) continue;
      if (!Number.isFinite(dueAt)) continue;
      const index = dayIndex(dueAt, boundaries);
      if (index >= 0) counts[index].grammar += 1;
    }
  }
  return counts;
}

function flashcardDueSql(boundaries: Date[]): string {
  const cases = boundaries
    .slice(1)
    .map((_, index) => `WHEN c.due_at < ? THEN ${index}`)
    .join(' ');
  return `SELECT CASE ${cases} ELSE NULL END AS day, count(*) AS total
    FROM native_flashcards c
    JOIN native_flashcard_notes n ON n.id = c.note_id AND n.owner_id = c.owner_id
    WHERE c.owner_id = ? AND c.suspended = 0 AND n.status = 'approved' AND c.due_at < ?
    GROUP BY day`;
}

async function flashcardDueCounts(
  client: Pick<Client, 'execute'>,
  userId: string,
  boundaries: Date[]
): Promise<number[]> {
  const dueCards = await client.execute({
    sql: flashcardDueSql(boundaries),
    args: [
      ...boundaries.slice(1).map((boundary) => boundary.getTime()),
      userId,
      boundaries[7].getTime()
    ]
  });
  const counts = Array.from({ length: 7 }, () => 0);
  for (const row of dueCards.rows) {
    const index = Number(row.day);
    if (index >= 0 && index < counts.length) counts[index] = Number(row.total);
  }
  return counts;
}

function reviewDueDays(
  counts: DueCounts[],
  boundaries: Date[],
  timezone: string
): ReviewDueDay[] {
  return counts.map((count, index) => ({
    date: localDate(boundaries[index], timezone),
    ...count,
    total: count.grammar + count.flashcards
  }));
}

export async function loadReviewDueByDay(
  client: Pick<Client, 'execute'>,
  learner: LearnerSession,
  tracks: GrammarTrack[],
  now = new Date()
): Promise<ReviewDueDay[]> {
  const timezone = (await getTimezone(client, learner)) ?? 'UTC';
  const boundaries = studyDayBoundaries(now, timezone);
  const counts = grammarDueCounts(tracks, boundaries);
  const flashcards = await flashcardDueCounts(
    client,
    learner.userId,
    boundaries
  );
  counts.forEach((count, index) => (count.flashcards = flashcards[index]));
  return reviewDueDays(counts, boundaries, timezone);
}
