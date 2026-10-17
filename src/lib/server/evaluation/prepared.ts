import type { ExerciseFormat } from '../../components/exercises/answer';

// The deterministic prepared-answer evaluator. It compares an answer with the
// checked answer and rubric alternatives the content carries and never calls
// a model. A typed answer it cannot match is "uncertain", not wrong: that is
// the case the bounded fallback evaluates.

export const PREPARED_EVALUATOR_VERSION = 'prepared-1';

/** The rule every content module states; the corpus test holds them equal. */
export const PREPARED_MATCHING_RULE =
  'Typed answers ignore letter case, extra spaces, apostrophe style and final . ! or ? punctuation. Accents and every other character count. Multiple-choice answers must match exactly.';

export type PreparedOutcome = 'correct' | 'incorrect' | 'uncertain';

export type PreparedQuestion = {
  format: ExerciseFormat;
  /** Null only for questions imported before answers were stored. */
  answer: string | null;
  /** Options for multiple choice; accepted answers for every other format. */
  alternatives: readonly string[];
};

/**
 * The form two typed answers are compared in. Accents, inner punctuation and
 * every other character are kept, so the grammar error itself is never
 * normalised away.
 */
export function typedMatchKey(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s?[.!?]$/, '')
    .toLowerCase();
}

/** Evaluate an answer against the question's own checked rubric. */
export function evaluatePrepared(
  question: PreparedQuestion,
  answer: string
): PreparedOutcome {
  if (question.answer === null) return 'uncertain';
  if (question.format === 'multiple-choice')
    return answer === question.answer ? 'correct' : 'incorrect';
  const accepted = [question.answer, ...question.alternatives].map(
    typedMatchKey
  );
  return accepted.includes(typedMatchKey(answer)) ? 'correct' : 'uncertain';
}
