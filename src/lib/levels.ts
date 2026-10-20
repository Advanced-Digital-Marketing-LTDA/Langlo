/** Every level a track can use, lowest first. */
export const LEVELS = ['A1', 'A2', 'B1', 'B2'] as const;

export type Level = (typeof LEVELS)[number];

const ASSESSMENT_LEVELS = {
  fr: ['A1', 'A2'],
  de: ['A1', 'A2'],
  en: ['A1', 'A2'],
  pt: ['B1', 'B2']
} as const satisfies Record<string, readonly [Level, Level]>;

/**
 * The two levels a placement assessment reports for a track. Portuguese
 * (Brazil) starts at B1; every other track is assessed over A1 and A2.
 * A language without an entry is a bug, so it throws rather than guessing.
 */
export function assessmentLevels(language: string): readonly [Level, Level] {
  if (!Object.hasOwn(ASSESSMENT_LEVELS, language))
    throw new Error(`No assessment levels defined for language "${language}"`);
  return ASSESSMENT_LEVELS[language as keyof typeof ASSESSMENT_LEVELS];
}

/** The lowest assessed level: the foundation a learner revisits first. */
export function foundationLevel(language: string): Level {
  return assessmentLevels(language)[0];
}
