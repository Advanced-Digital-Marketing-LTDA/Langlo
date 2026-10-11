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
  const quoted = /«([^»]+)»/u
    .exec(missed.prompt)?.[1]
    .trim()
    .replace(/\.$/u, '');
  const label = quoted ? `« ${quoted} »` : missed.prompt;
  return `${label} — ${missed.expected}, not ${missed.yourAnswer}`;
}

// Stable per-mistake identity so a keep survives page remounts and a repeat
// keep is a no-op — the same prompt maps to the same draft note id.
export function draftIdFor(missed: MissedItem): string {
  const slug = missed.prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `n-session-${slug || 'item'}`;
}
