// Checks a learner's answer before it is sent. The same function runs in the
// browser, for a quick message, and on the server, which decides: nothing the
// browser says is trusted.

export const ANSWER_LIMIT = 4096;

export type ExerciseFormat =
  'multiple-choice' | 'typed-blank' | 'translation' | 'correction';

/** The learner-facing question; the expected answer is never part of it. */
export type ExerciseQuestion = {
  id: string;
  format: ExerciseFormat;
  prompt: string;
  alternatives?: string[] | undefined;
};

export type AnswerCheck =
  | { ok: true; answer: string }
  | { ok: false; code: AnswerProblem; message: string };

export type AnswerProblem = 'EMPTY' | 'TOO_LONG' | 'NOT_AN_OPTION' | 'INVALID';

const messages: Record<AnswerProblem, string> = {
  EMPTY: 'Enter an answer before you submit.',
  TOO_LONG: `Your answer is too long. Keep it under ${ANSWER_LIMIT} characters.`,
  NOT_AN_OPTION: 'Choose one of the listed answers.',
  INVALID: 'Your answer contains characters that cannot be sent.'
};

function problem(code: AnswerProblem): AnswerCheck {
  return { ok: false, code, message: messages[code] };
}

function textProblem(format: ExerciseFormat, text: string) {
  if (text.includes('\0')) return 'INVALID';
  // A fill-in-the-blank answer is one line; the other formats are sentences.
  if (format === 'typed-blank' && /[\r\n]/.test(text)) return 'INVALID';
  if (Array.from(text).length > ANSWER_LIMIT) return 'TOO_LONG';
  return undefined;
}

/** The form an answer is stored in: composed accents, no outer whitespace. */
export function normalizeAnswer(raw: string): string {
  return raw.normalize('NFC').trim();
}

/**
 * Normalise (composed accents, so "é" is one form however it was typed), trim,
 * and reject empty, oversized and malformed input. A multiple-choice answer
 * must be one of the options the question offers.
 */
export function checkAnswer(
  format: ExerciseFormat,
  raw: unknown,
  alternatives: readonly string[] = []
): AnswerCheck {
  if (typeof raw !== 'string') return problem('INVALID');
  // Bound the work before normalising an arbitrarily large string.
  if (raw.length > ANSWER_LIMIT * 2) return problem('TOO_LONG');
  const answer = normalizeAnswer(raw);
  if (!answer) return problem('EMPTY');
  const rejected = textProblem(format, answer);
  if (rejected) return problem(rejected);
  if (format === 'multiple-choice') {
    const options = alternatives.map(normalizeAnswer);
    if (!options.includes(answer)) return problem('NOT_AN_OPTION');
  }
  return { ok: true, answer };
}

const accents: Record<string, readonly string[]> = {
  fr: ['à', 'â', 'ç', 'é', 'è', 'ê', 'ë', 'î', 'ï', 'ô', 'ù', 'û', 'œ'],
  de: ['ä', 'ö', 'ü', 'ß']
};

/** The accented letters a keyboard may lack, for a track's language. */
export function accentsFor(language: string): readonly string[] {
  return Object.hasOwn(accents, language) ? (accents[language] ?? []) : [];
}

/**
 * The form action URL. Without JavaScript the browser replaces the whole query
 * string with the action's, so the session the page was opened with is kept in
 * it and the learner lands back on their next question.
 */
export function answerActionUrl(studySessionId: string): string {
  return `?session=${encodeURIComponent(studySessionId)}&/answer`;
}
