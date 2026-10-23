import type { Client } from '@libsql/client';
import { getTimezone } from './preferences';
import type { LearnerSession } from './learner-session';
import { StudyError } from './study-error';
import { studyDayStart } from './study-days';

export type StudyTimeCategory = 'flashcards' | 'grammar';

export type StudyTimeDay = {
  date: string;
  // Seconds of active study, or null when the day has no recorded time.
  flashcardsSeconds: number | null;
  grammarSeconds: number | null;
};

const categories: readonly StudyTimeCategory[] = ['flashcards', 'grammar'];
const firstDayOffset = -365;
const todayIndex = 365;
// A browser clock may run slightly ahead of the server's.
const clockSkewMs = 60_000;
const maxSegmentMs = 24 * 60 * 60 * 1000;
const maxSegmentAgeMs = 7 * 24 * 60 * 60 * 1000;

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

/** Save one timed stretch for the caller; anything malformed is rejected. */
export async function recordStudyTime(
  client: Pick<Client, 'execute'>,
  learner: LearnerSession,
  body: Record<string, unknown>,
  now = Date.now()
): Promise<{ saved: true }> {
  const { id, category, startedAt, endedAt } = body;
  if (
    typeof id !== 'string' ||
    id.length < 1 ||
    id.length > 64 ||
    !categories.includes(category as StudyTimeCategory) ||
    !Number.isSafeInteger(startedAt) ||
    !Number.isSafeInteger(endedAt)
  )
    throw new StudyError('INVALID_STUDY_TIME');
  const start = startedAt as number;
  const end = endedAt as number;
  if (
    start >= end ||
    end - start > maxSegmentMs ||
    end > now + clockSkewMs ||
    start < now - maxSegmentAgeMs
  )
    throw new StudyError('INVALID_STUDY_TIME');
  await client.execute({
    sql: `INSERT INTO study_time_segments (id, owner_id, category, started_at, ended_at)
      VALUES (?, ?, ?, ?, ?)`,
    args: [id, learner.userId, category as StudyTimeCategory, start, end]
  });
  return { saved: true };
}

/**
 * Active study seconds per study day through today, split at study-day
 * boundaries. The range starts at `firstDate` (the review history start) or
 * the first day with recorded time, whichever is earlier, within 365 days.
 */
export async function loadStudyTime(
  client: Pick<Client, 'execute'>,
  learner: LearnerSession,
  firstDate: string,
  nowInput: Date | number = Date.now()
): Promise<StudyTimeDay[]> {
  const now = nowInput instanceof Date ? nowInput.getTime() : nowInput;
  const timezone = (await getTimezone(client, learner)) ?? 'UTC';
  const boundaries = Array.from({ length: todayIndex + 2 }, (_, index) =>
    studyDayStart(new Date(now), timezone, index + firstDayOffset).getTime()
  );
  const rangeStart = boundaries[0];
  const segments = await client.execute({
    sql: `SELECT category, started_at, ended_at FROM study_time_segments
      WHERE owner_id = ? AND started_at < ? AND ended_at > ?`,
    args: [learner.userId, now, rangeStart]
  });
  const seconds = {
    flashcards: Array.from({ length: todayIndex + 1 }, () => 0),
    grammar: Array.from({ length: todayIndex + 1 }, () => 0)
  };
  const recorded = Array.from({ length: todayIndex + 1 }, () => false);
  for (const row of segments.rows) {
    const category = String(row.category) as StudyTimeCategory;
    const start = Math.max(Number(row.started_at), rangeStart);
    const end = Math.min(Number(row.ended_at), now);
    for (let index = 0; index <= todayIndex; index += 1) {
      const overlap =
        Math.min(end, boundaries[index + 1]) -
        Math.max(start, boundaries[index]);
      if (overlap <= 0) continue;
      seconds[category][index] += overlap / 1000;
      recorded[index] = true;
    }
  }
  const dates = boundaries
    .slice(0, todayIndex + 1)
    .map((boundary) => localDate(new Date(boundary), timezone));
  const starts = [recorded.indexOf(true), dates.indexOf(firstDate)].filter(
    (index) => index >= 0
  );
  if (!starts.length) return [];
  const startIndex = Math.min(...starts);

  return dates.slice(startIndex).map((date, offset) => {
    const index = startIndex + offset;
    return {
      date,
      flashcardsSeconds: recorded[index]
        ? Math.round(seconds.flashcards[index])
        : null,
      grammarSeconds: recorded[index]
        ? Math.round(seconds.grammar[index])
        : null
    };
  });
}
