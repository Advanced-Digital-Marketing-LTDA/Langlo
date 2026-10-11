// Session-derived results helpers for the T005 prototype. All data is
// synthetic and in-memory only — the prototype has no backend.
import { defaultResults, type ResultsBreakdown } from './data';

export interface SessionAnswer {
  prompt: string;
  yourAnswer: string;
  expected: string;
  outcome: 'correct' | 'incorrect' | 'uncertain';
}

export type MissedItem = ResultsBreakdown['missedItems'][number];

// Records one submitted answer. A run's first answer starts a fresh list —
// recorded answers are only ever replaced here, never by page navigation —
// so a completed run survives revisiting practice in the same session.
export function recordRunAnswer(
  session: { answers: SessionAnswer[] },
  answer: SessionAnswer,
  isNewRun: boolean
) {
  if (isNewRun) session.answers = [];
  session.answers.push(answer);
}

// Outcome totals likewise come from recorded answers when a run happened,
// so a stripped-URL results view stays consistent with the mistake list.
export function deriveTotals(answers: SessionAnswer[]) {
  let correct = 0;
  let incorrect = 0;
  let uncertain = 0;
  for (const answer of answers) {
    if (answer.outcome === 'correct') correct += 1;
    else if (answer.outcome === 'incorrect') incorrect += 1;
    else uncertain += 1;
  }
  return { correct, incorrect, uncertain };
}

// Displayed mistakes come from the learner's recorded answers. When no
// practice run happened this session (direct navigation for design review)
// the fixture breakdown stands in so the screen still renders its variants.
export function deriveMissedItems(
  answers: SessionAnswer[],
  incorrectCount: number
): MissedItem[] {
  if (answers.length === 0) {
    return incorrectCount > 0 ? defaultResults.missedItems : [];
  }
  return answers
    .filter((answer) => answer.outcome === 'incorrect')
    .map(({ prompt, yourAnswer, expected }) => ({
      prompt,
      yourAnswer,
      expected
    }));
}

// Draft previews follow the existing fixture style: pull the quoted exercise
// out of the prompt when present, then «expected», not «yourAnswer».
export function mistakePreview(missed: MissedItem): string {
  const open = missed.prompt.indexOf('«');
  const close = open === -1 ? -1 : missed.prompt.indexOf('»', open + 1);
  let quoted = close === -1 ? '' : missed.prompt.slice(open + 1, close).trim();
  if (quoted.endsWith('.')) quoted = quoted.slice(0, -1);
  const label = quoted ? `« ${quoted} »` : missed.prompt;
  return `${label} — ${missed.expected}, not ${missed.yourAnswer}`;
}

const isSlugChar = (char: string) =>
  (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9');

const slugify = (value: string, limit: number) =>
  [...value.toLowerCase()]
    .map((char) => (isSlugChar(char) ? char : '-'))
    .join('')
    .split('-')
    .filter(Boolean)
    .join('-')
    .slice(0, limit);

// Stable per-mistake identity so a keep survives page remounts and a repeat
// keep is a no-op. The answer is part of the identity: answering the same
// prompt wrongly a different way is a different mistake, not a duplicate.
export function draftIdFor(missed: MissedItem): string {
  const prompt = slugify(missed.prompt, 40) || 'item';
  const answer = slugify(missed.yourAnswer, 24) || 'blank';
  return `n-session-${prompt}-${answer}`;
}
