import { bundlePackage } from '../../src/lib/server/content-bundle';
import type { ContentPackage } from '../../src/lib/server/content-import';
import type { Client } from '@libsql/client';
import { afterEach, beforeEach, expect } from 'vitest';
import { openFixtureDatabase } from '../../src/lib/server/db/connection';
import { disposeFlashcardFixtures, fixture } from './flashcards';

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

export function assertUniqueQuestions(questions: Question[]) {
  const ids = questions.map((q) => q.id);
  expect(new Set(ids).size).toBe(ids.length);
  const prompts = questions.map((q) => normalize(q.prompt));
  expect(new Set(prompts).size).toBe(prompts.length);
}

/** Each import test gets a real, disposable database and guaranteed cleanup. */
export function moduleImportFixture() {
  let client: Client;
  let close: (() => void) | undefined;
  beforeEach(async () => {
    ({ client, close } = await openFixtureDatabase(await fixture()));
  });
  afterEach(async () => {
    try {
      close?.();
    } finally {
      close = undefined;
      await disposeFlashcardFixtures();
    }
  });
  return {
    get client() {
      return client;
    },
    async count(
      table:
        | 'skills'
        | 'prerequisites'
        | 'content_versions'
        | 'questions'
        | 'curriculum_imports'
    ) {
      return Number(
        (await client.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n
      );
    }
  };
}

/** The approved bundle plus this module's lessons, for the importer. */
export function modulePackage(
  root: string,
  module: Module,
  review = module.review_status,
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
