import { randomUUID } from 'node:crypto';
import type { Client } from '@libsql/client';
import type { LearnerSession } from './learner-session';
import { executeWrite } from './flashcards';
import { StudyError } from './study-error';
import { LEVELS } from '../levels';

export const TRACK_LANGUAGES = ['fr', 'de', 'en', 'pt'] as const;
export const STARTING_LEVELS = LEVELS;
export const EXPLANATION_LANGUAGES = ['en', 'pt'] as const;

const LEVELS_BY_LANGUAGE: Record<TrackLanguage, readonly StartingLevel[]> = {
  fr: ['A1'],
  de: ['A1', 'A2'],
  en: ['A1', 'A2'],
  pt: ['B1', 'B2']
};

/** The database only accepts French at A1, German and English at A1 or A2, Portuguese at B1 or B2. */
export function levelsFor(language: TrackLanguage): readonly StartingLevel[] {
  return LEVELS_BY_LANGUAGE[language];
}

/** Portuguese lessons are explained in English; the other tracks offer both. */
export function explanationLanguagesFor(
  language: TrackLanguage
): readonly ExplanationLanguage[] {
  return language === 'pt' ? ['en'] : EXPLANATION_LANGUAGES;
}

/** Lesson languages offered for every track, keyed by track language. */
export function explanationLanguagesByTrack(): Record<
  string,
  readonly ExplanationLanguage[]
> {
  return Object.fromEntries(
    TRACK_LANGUAGES.map((language) => [
      language,
      explanationLanguagesFor(language)
    ])
  );
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
  if (
    !levelsFor(enrollment.language).includes(enrollment.startingLevel) ||
    !explanationLanguagesFor(enrollment.language).includes(
      enrollment.explanationLanguage
    )
  )
    throw new StudyError('INVALID_ENROLLMENT');
  const result = await executeWrite(client, {
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
  if (!explanationLanguagesFor(language).includes(explanationLanguage))
    throw new StudyError('INVALID_ENROLLMENT');
  const result = await executeWrite(client, {
    sql: 'UPDATE enrollments SET explanation_language = ? WHERE owner_id = ? AND language = ?',
    args: [explanationLanguage, learner.userId, language]
  });
  if (result.rowsAffected !== 1) throw new StudyError('NOT_FOUND');
}
