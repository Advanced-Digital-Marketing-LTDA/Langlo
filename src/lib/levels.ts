/** Every level a track can use, lowest first. */
export const LEVELS = ['A1', 'A2', 'B1', 'B2'] as const;

export type Level = (typeof LEVELS)[number];

/**
 * The two levels a placement assessment reports for a track. Portuguese
 * (Brazil) starts at B1; every other track is assessed over A1 and A2.
 */
export function assessmentLevels(language: string): readonly [Level, Level] {
  return language === 'pt' ? ['B1', 'B2'] : ['A1', 'A2'];
}

/** The lowest assessed level: the foundation a learner revisits first. */
export function foundationLevel(language: string): Level {
  return assessmentLevels(language)[0];
}
