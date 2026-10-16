import { bundlePackage } from '../../src/lib/server/content-bundle';
import type { ContentPackage } from '../../src/lib/server/content-import';

// Shared by the authored-module tests: module JSON types, the local
// answer-matching rule the modules declare, and the import package builder.

export type Question = {
  id: string;
  format: 'multiple-choice' | 'typed-blank' | 'translation' | 'correction';
  prompt: string;
  answer: string;
  alternatives?: string[];
  near_misses?: string[];
  holdout: boolean;
};

export type Lesson = {
  skill_id: string;
  title: string;
  explanation: string;
  examples: { fr?: string; de?: string; en: string }[];
  references: string[];
  version: { id: string; version: number; questions: Question[] };
};

export type Module = {
  module_id: string;
  track: string;
  title: string;
  instruction_language: string;
  review_status: string;
  matching: string;
  lessons: Lesson[];
};

export const formats = [
  'multiple-choice',
  'typed-blank',
  'translation',
  'correction'
];

// Case, surrounding and repeated spaces, typographic apostrophes and final
// . ! or ? are ignored; accents and every other character count.
export function normalize(value: string) {
  return value
    .normalize('NFC')
    .replace(/[‘’ʼ‛]/gu, "'")
    .trim()
    .replace(/[.!?]+$/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

// Multiple-choice answers must match exactly; typed answers use normalize.
export function accepts(question: Question, response: string) {
  if (question.format === 'multiple-choice')
    return response === question.answer;
  return [question.answer, ...(question.alternatives ?? [])].some(
    (item) => normalize(item) === normalize(response)
  );
}

export const typedAnswers = (q: Question) =>
  q.format === 'multiple-choice'
    ? [q.answer]
    : [q.answer, ...(q.alternatives ?? [])];

/** The approved bundle plus this module's lessons, for the importer. */
export function modulePackage(
  root: string,
  module: Module,
  review: string,
  version?: string
): ContentPackage {
  const pkg = bundlePackage(root);
  return {
    ...pkg,
    curriculumVersion: version ?? pkg.curriculumVersion,
    versions: module.lessons.map((lesson) => ({
      id: lesson.version.id,
      skillId: lesson.skill_id,
      version: lesson.version.version,
      review,
      questions: lesson.version.questions.map((q) => ({
        id: q.id,
        format: q.format,
        prompt: q.prompt,
        answer: q.answer,
        alternatives: q.alternatives
      }))
    }))
  };
}
