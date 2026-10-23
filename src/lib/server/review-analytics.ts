import type { Client } from '@libsql/client';
import { getTimezone } from './preferences';
import type { LearnerSession } from './learner-session';
import { studyDayStart } from './study-days';

export type ReviewAnalyticsDay = {
  date: string;
  flashcardsCompleted: number | null;
  grammarCompleted: number | null;
  flashcardsScheduled: number | null;
  grammarScheduled: number | null;
};

type GrammarTrack = {
  skills: { available: boolean; retention: { dueAt: number | null } }[];
};

const firstDayOffset = -365;
const todayIndex = 365;
const endOffset = 366;

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
  if (
    timestamp < boundaries[0].getTime() ||
    timestamp >= boundaries.at(-1)!.getTime()
  )
    return -1;
  let low = 1;
  let high = boundaries.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (timestamp < boundaries[middle].getTime()) high = middle;
    else low = middle + 1;
  }
  return low - 1;
}

function studyDayBoundaries(now: Date, timezone: string): Date[] {
  return Array.from({ length: endOffset - firstDayOffset + 1 }, (_, index) =>
    studyDayStart(now, timezone, index + firstDayOffset)
  );
}

function scheduledGrammarCounts(
  tracks: GrammarTrack[],
  boundaries: Date[]
): number[] {
  const counts = Array.from({ length: boundaries.length - 1 }, () => 0);
  const today = boundaries[todayIndex].getTime();
  for (const track of tracks) {
    for (const skill of track.skills) {
      if (!skill.available) continue;
      const dueAt = skill.retention.dueAt;
      if (dueAt === null || !Number.isFinite(dueAt)) continue;
      const index = dueAt < today ? todayIndex : dayIndex(dueAt, boundaries);
      if (index >= todayIndex) counts[index] += 1;
    }
  }
  return counts;
}

async function scheduledFlashcardCounts(
  client: Pick<Client, 'execute'>,
  userId: string,
  boundaries: Date[]
): Promise<number[]> {
  const thresholds = boundaries.slice(todayIndex + 1);
  const cases = thresholds
    .map((_, index) => `WHEN c.due_at < ? THEN ${todayIndex + index}`)
    .join(' ');
  const dueCards = await client.execute({
    sql: `SELECT CASE ${cases} ELSE NULL END AS day, count(*) AS total
      FROM native_flashcards c
      JOIN native_flashcard_notes n ON n.id = c.note_id AND n.owner_id = c.owner_id
      WHERE c.owner_id = ? AND c.suspended = 0 AND n.status = 'approved' AND c.due_at < ?
      GROUP BY day`,
    args: [
      ...thresholds.map((boundary) => boundary.getTime()),
      userId,
      boundaries.at(-1)!.getTime()
    ]
  });
  const counts = Array.from({ length: boundaries.length - 1 }, () => 0);
  for (const row of dueCards.rows) {
    if (row.day === null) continue;
    const index = Number(row.day);
    if (index >= todayIndex && index < counts.length)
      counts[index] = Number(row.total);
  }
  return counts;
}

async function completedReviewCounts(
  client: Pick<Client, 'execute'>,
  table: 'native_flashcard_review_events' | 'grammar_retention_events',
  userId: string,
  start: number,
  now: number,
  boundaries: Date[]
): Promise<number[]> {
  const events = await client.execute({
    sql: `SELECT reviewed_at, count(*) AS total FROM ${table}
      WHERE owner_id = ? AND reviewed_at >= ? AND reviewed_at <= ?
      GROUP BY reviewed_at`,
    args: [userId, start, now]
  });
  const counts = Array.from({ length: boundaries.length - 1 }, () => 0);
  for (const row of events.rows) {
    const index = dayIndex(Number(row.reviewed_at), boundaries);
    if (index >= 0 && index <= todayIndex) counts[index] += Number(row.total);
  }
  return counts;
}

export async function loadReviewAnalytics(
  client: Pick<Client, 'execute'>,
  learner: LearnerSession,
  tracks: GrammarTrack[],
  nowInput: Date | number = Date.now()
): Promise<ReviewAnalyticsDay[]> {
  const now = nowInput instanceof Date ? nowInput.getTime() : nowInput;
  const timezone = (await getTimezone(client, learner)) ?? 'UTC';
  const boundaries = studyDayBoundaries(new Date(now), timezone);
  const [flashcardsCompleted, grammarCompleted, flashcardsScheduled] =
    await Promise.all([
      completedReviewCounts(
        client,
        'native_flashcard_review_events',
        learner.userId,
        boundaries[0].getTime(),
        now,
        boundaries
      ),
      completedReviewCounts(
        client,
        'grammar_retention_events',
        learner.userId,
        boundaries[0].getTime(),
        now,
        boundaries
      ),
      scheduledFlashcardCounts(client, learner.userId, boundaries)
    ]);
  const grammarScheduled = scheduledGrammarCounts(tracks, boundaries);
  const firstCompletedIndex = flashcardsCompleted.findIndex(
    (count, index) => count > 0 || grammarCompleted[index] > 0
  );
  const startIndex =
    firstCompletedIndex >= 0 ? firstCompletedIndex : todayIndex;
  let endIndex = todayIndex;
  for (let index = todayIndex; index < flashcardsScheduled.length; index += 1) {
    if (flashcardsScheduled[index] || grammarScheduled[index]) endIndex = index;
  }

  return Array.from({ length: endIndex - startIndex + 1 }, (_, offset) => {
    const index = startIndex + offset;
    return {
      date: localDate(boundaries[index], timezone),
      flashcardsCompleted:
        index <= todayIndex ? flashcardsCompleted[index] : null,
      grammarCompleted: index <= todayIndex ? grammarCompleted[index] : null,
      flashcardsScheduled:
        index >= todayIndex ? flashcardsScheduled[index] : null,
      grammarScheduled: index >= todayIndex ? grammarScheduled[index] : null
    };
  });
}
