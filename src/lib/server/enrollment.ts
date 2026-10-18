import { randomUUID } from 'node:crypto';
import type { Client } from '@libsql/client';
import type { LearnerSession } from './learner-session';
import { StudyError } from './study-error';

export const TRACK_LANGUAGES = ['fr', 'de', 'en'] as const;
export const STARTING_LEVELS = ['A1', 'A2'] as const;
export const EXPLANATION_LANGUAGES = ['en', 'pt'] as const;

/** The database only accepts French at A1; German and English at A1 or A2. */
export function levelsFor(language: TrackLanguage): readonly StartingLevel[] {
  return language === 'fr' ? ['A1'] : STARTING_LEVELS;
}

export type TrackLanguage = (typeof TRACK_LANGUAGES)[number];
export type StartingLevel = (typeof STARTING_LEVELS)[number];
export type ExplanationLanguage = (typeof EXPLANATION_LANGUAGES)[number];

export type Enrollment = {
  language: TrackLanguage;
  startingLevel: StartingLevel;
  explanationLanguage: ExplanationLanguage;
};

function oneOf<T extends string>(
  allowed: readonly T[],
  value: unknown,
  code: string
): T {
  if (
    typeof value !== 'string' ||
    !(allowed as readonly string[]).includes(value)
  )
    throw new StudyError(code);
  return value as T;
}

/** The caller's enrollments, ordered by language. */
export async function listEnrollments(
  client: Pick<Client, 'execute'>,
  learner: LearnerSession
): Promise<Enrollment[]> {
  const result = await client.execute({
    sql: 'SELECT language, starting_level, explanation_language FROM enrollments WHERE owner_id = ? ORDER BY language',
    args: [learner.userId]
  });
  return result.rows.map((row) => ({
    language: String(row.language) as TrackLanguage,
    startingLevel: String(row.starting_level) as StartingLevel,
    explanationLanguage: String(row.explanation_language) as ExplanationLanguage
  }));
}

/**
 * Enroll the caller in a track. A second enrollment in the same language is a
 * conflict, never a silent update of the first.
 */
export async function enroll(
  client: Pick<Client, 'execute'>,
  learner: LearnerSession,
  input: Record<keyof Enrollment, unknown>
): Promise<Enrollment> {
  const enrollment: Enrollment = {
    language: oneOf(TRACK_LANGUAGES, input.language, 'INVALID_ENROLLMENT'),
    startingLevel: oneOf(
      STARTING_LEVELS,
      input.startingLevel,
      'INVALID_ENROLLMENT'
    ),
    explanationLanguage: oneOf(
      EXPLANATION_LANGUAGES,
      input.explanationLanguage,
      'INVALID_ENROLLMENT'
    )
  };
  if (!levelsFor(enrollment.language).includes(enrollment.startingLevel))
    throw new StudyError('INVALID_ENROLLMENT');
  const result = await client.execute({
    sql: `INSERT INTO enrollments (id, owner_id, language, starting_level, explanation_language)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT (owner_id, language) DO NOTHING`,
    args: [
      `enrollment:${randomUUID()}`,
      learner.userId,
      enrollment.language,
      enrollment.startingLevel,
      enrollment.explanationLanguage
    ]
  });
  if (result.rowsAffected !== 1) throw new StudyError('ALREADY_ENROLLED');
  return enrollment;
}

/** Change the language lessons are written in for one of the caller's tracks. */
export async function setExplanationLanguage(
  client: Pick<Client, 'execute'>,
  learner: LearnerSession,
  input: { language: unknown; explanationLanguage: unknown }
): Promise<void> {
  const language = oneOf(TRACK_LANGUAGES, input.language, 'INVALID_ENROLLMENT');
  const explanationLanguage = oneOf(
    EXPLANATION_LANGUAGES,
    input.explanationLanguage,
    'INVALID_ENROLLMENT'
  );
  const result = await client.execute({
    sql: 'UPDATE enrollments SET explanation_language = ? WHERE owner_id = ? AND language = ?',
    args: [explanationLanguage, learner.userId, language]
  });
  if (result.rowsAffected !== 1) throw new StudyError('NOT_FOUND');
}
