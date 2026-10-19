import type { Client } from '@libsql/client';
import type { LearnerSession } from './learner-session';
import { loadEnrolledMastery } from './mastery';
import { recommendTopics } from './recommendations';

export type TrackProgress = {
  language: string;
  level: string;
  skills: Awaited<ReturnType<typeof loadEnrolledMastery>>[number]['skills'];
  recommendation: ReturnType<typeof recommendTopics>;
};

export async function loadProgress(
  client: Client,
  learner: LearnerSession,
  language: string | null = null
) {
  const enrolled = await loadEnrolledMastery(client, learner, language);
  const tracks: TrackProgress[] = enrolled.map(
    ({ language, level, skills }) => ({
      language,
      level,
      skills,
      recommendation: recommendTopics(skills)
    })
  );
  return { tracks };
}
