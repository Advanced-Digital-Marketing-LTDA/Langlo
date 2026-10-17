import type { Client } from '@libsql/client';
import type { LearnerSession } from './learner-session';
import { getMastery } from './mastery';
import { recommendTopics } from './recommendations';
import { StudyError } from './study-error';

export type TrackProgress = {
  language: string;
  level: string;
  skills: Awaited<ReturnType<typeof getMastery>>;
  recommendation: ReturnType<typeof recommendTopics>;
};

export async function loadProgress(
  client: Client,
  learner: LearnerSession,
  language: string | null = null
) {
  const enrolled = await client.execute({
    sql: 'SELECT language, starting_level FROM enrollments WHERE owner_id = ? ORDER BY language',
    args: [learner.userId]
  });
  if (
    language !== null &&
    !enrolled.rows.some((row) => row.language === language)
  )
    throw new StudyError('NOT_FOUND');
  const tracks: TrackProgress[] = [];
  for (const row of enrolled.rows) {
    if (language !== null && row.language !== language) continue;
    const skills = await getMastery(client, learner, String(row.language));
    tracks.push({
      language: String(row.language),
      level: String(row.starting_level),
      skills,
      recommendation: recommendTopics(skills)
    });
  }
  return { tracks };
}
