import type { Client } from '@libsql/client';
import type { LearnerSession } from './learner-session';
import { listEnrollments } from './enrollment';
import { loadEnrolledCatalog, loadEnrolledMastery } from './mastery';
import { recommendTopics } from './recommendations';
import { StudyError } from './study-error';

export type TrackProgress = {
  language: string;
  level: string;
  skills: Awaited<ReturnType<typeof loadEnrolledMastery>>[number]['skills'];
  recommendation: ReturnType<typeof recommendTopics>;
};

export type StreamingTrackProgress = {
  language: string;
  level: string;
  catalog: ReturnType<typeof loadEnrolledCatalog>;
  progress: Promise<TrackProgress>;
};

/** Return each map track early, then its catalog and evidence as they load. */
export async function loadMapProgress(
  client: Client,
  learner: LearnerSession,
  language: string | null = null
) {
  const enrollments = await listEnrollments(client, learner);
  if (
    language !== null &&
    !enrollments.some((enrollment) => enrollment.language === language)
  )
    throw new StudyError('NOT_FOUND');

  let queued: Promise<void> = Promise.resolve();
  const tracks: StreamingTrackProgress[] = enrollments
    .filter(
      (enrollment) => language === null || enrollment.language === language
    )
    .map((enrollment) => {
      const { language: trackLanguage, startingLevel: level } = enrollment;
      let catalogLoaded = false;
      const catalog = queued
        .then(() => loadEnrolledCatalog(client, learner, trackLanguage))
        .then((result) => {
          catalogLoaded = true;
          return result;
        })
        .catch((error: unknown) => {
          console.error(`Failed to load ${trackLanguage} map catalog`, error);
          throw error;
        });
      const progress = catalog
        .then(async () => {
          const [track] = await loadEnrolledMastery(
            client,
            learner,
            trackLanguage
          );
          return {
            ...track,
            recommendation: recommendTopics(track.skills)
          };
        })
        .catch((error: unknown) => {
          if (catalogLoaded)
            console.error(
              `Failed to load ${trackLanguage} map progress`,
              error
            );
          throw error;
        });
      queued = progress.then(
        () => undefined,
        () => undefined
      );
      return { language: trackLanguage, level, catalog, progress };
    });
  return { tracks };
}

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
