import type { Client } from '@libsql/client';
import type { LearnerSession } from './learner-session';
import { listEnrollments } from './enrollment';
import {
  loadEnrolledCatalog,
  loadEnrolledMastery,
  loadEnrolledMasteryWith
} from './mastery';
import { recommendTopics } from './recommendations';
import { StudyError } from './study-error';
import {
  grammarRetentionFor,
  grammarRetentionOf,
  grammarRetentionStatements,
  type GrammarRetention
} from './grammar-retention';

type MasterySkill = Awaited<
  ReturnType<typeof loadEnrolledMastery>
>[number]['skills'][number];
type ProgressSkill = MasterySkill & { retention: GrammarRetention };

export type TrackProgress = {
  language: string;
  level: string;
  skills: ProgressSkill[];
  recommendation: ReturnType<typeof recommendTopics>;
};

export type StreamingTrackProgress = {
  language: string;
  level: string;
  catalog: ReturnType<typeof loadEnrolledCatalog>;
  progress: Promise<TrackProgress>;
};

type MapEnrollment = { language: string; startingLevel: string };

/** Start one track's catalog and, once it loads, its progress. */
function streamTrack(
  client: Client,
  learner: LearnerSession,
  { language, startingLevel: level }: MapEnrollment,
  queued: Promise<void>
) {
  let catalogLoaded = false;
  const catalog = queued
    .then(() => loadEnrolledCatalog(client, learner, language))
    .then((result) => {
      catalogLoaded = true;
      return result;
    })
    .catch((error: unknown) => {
      console.error(`Failed to load ${language} map catalog`, error);
      throw error;
    });
  const progress = catalog
    .then(async () => {
      const [track] = await loadEnrolledMastery(client, learner, language);
      const retention = await grammarRetentionFor(client, learner, language);
      const retained = new Map(
        retention.map((skill) => [skill.skillId, skill.retention])
      );
      return {
        ...track,
        skills: track.skills.map((skill) => ({
          ...skill,
          retention: retained.get(skill.skillId) ?? {
            state: 'not-assessed',
            dueAt: null,
            lastReviewedAt: null,
            retrievability: null,
            target: 0.9
          }
        })),
        recommendation: recommendTopics(track.skills)
      };
    })
    .catch((error: unknown) => {
      if (catalogLoaded)
        console.error(`Failed to load ${language} map progress`, error);
      throw error;
    });
  const settled = progress.then(
    () => undefined,
    () => undefined
  );
  return { track: { language, level, catalog, progress }, settled };
}

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
      const { track, settled } = streamTrack(
        client,
        learner,
        enrollment,
        queued
      );
      queued = settled;
      return track;
    });
  return { tracks };
}

export async function loadProgress(
  client: Client,
  learner: LearnerSession,
  language: string | null = null
) {
  const now = Date.now();
  // The retention reads go in the same batch as the mastery reads.
  const enrolled = await loadEnrolledMasteryWith(client, learner, language, {
    statements: (trackLanguage) =>
      grammarRetentionStatements(learner, trackLanguage),
    read: (rows) => grammarRetentionOf(rows, now)
  });
  const tracks: TrackProgress[] = enrolled.map(
    ({ language, level, skills, alongside: retention }) => {
      const retained = new Map(
        retention.map((skill) => [skill.skillId, skill.retention])
      );
      const progressSkills = skills.map((skill) => ({
        ...skill,
        retention: retained.get(skill.skillId) ?? {
          state: 'not-assessed' as const,
          dueAt: null,
          lastReviewedAt: null,
          retrievability: null,
          target: 0.9
        }
      }));
      return {
        language,
        level,
        skills: progressSkills,
        recommendation: recommendTopics(progressSkills)
      };
    }
  );
  return { tracks };
}
