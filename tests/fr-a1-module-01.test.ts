import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { bundlePackage } from '../src/lib/server/content-bundle';
import {
  importContent,
  type ContentPackage
} from '../src/lib/server/content-import';
import { columnIndex, parseCsv } from '../scripts/curriculum-contract.mjs';
import { disposeFlashcardFixtures, fixture } from './fixtures/flashcards';

// French A1 module 01 (LANGLO-35): checks the authored module against the
// approved curriculum bundle and the importer, and pins answer matching with
// holdout and near-miss cases. Nothing here marks the module as reviewed.

type Question = {
  id: string;
  format: 'multiple-choice' | 'typed-blank' | 'translation' | 'correction';
  prompt: string;
  answer: string;
  alternatives?: string[];
  near_misses?: string[];
  holdout: boolean;
};

type Lesson = {
  skill_id: string;
  title: string;
  explanation: string;
  examples: { fr: string; en: string }[];
  references: string[];
  version: { id: string; version: number; questions: Question[] };
};

type Module = {
  module_id: string;
  track: string;
  title: string;
  instruction_language: string;
  review_status: string;
  matching: string;
  lessons: Lesson[];
};

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const module = JSON.parse(read('content/fr-a1/module-01.json')) as Module;
const graph = JSON.parse(read('content/prerequisites.json')) as {
  nodes: { skill_id: string; prerequisites: string[] }[];
};
const catalog = new Map(
  parseCsv(read('docs/curriculum-coverage.csv'))
    .slice(1)
    .map((row) => [row[0], row])
);
const questions = module.lessons.flatMap((lesson) => lesson.version.questions);
const formats = ['multiple-choice', 'typed-blank', 'translation', 'correction'];

// The matching rule the module declares: case, surrounding and repeated
// spaces, typographic apostrophes and final punctuation are ignored; accents
// and every other character count.
function normalize(value: string) {
  return value
    .normalize('NFC')
    .replace(/[\u2018\u2019\u02bc\u201b]/gu, "'")
    .trim()
    .replace(/[.!?]+$/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

function accepts(question: Question, response: string) {
  if (question.format === 'multiple-choice')
    return response === question.answer;
  return [question.answer, ...(question.alternatives ?? [])].some(
    (item) => normalize(item) === normalize(response)
  );
}

function modulePackage(review: string, version?: string): ContentPackage {
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

describe('French A1 module 01', () => {
  it('covers the four approved skills in prerequisite order', () => {
    expect(module.track).toBe('French A1');
    expect(module.instruction_language).toBe('en');
    const ids = module.lessons.map((lesson) => lesson.skill_id);
    expect(ids).toEqual(['fr-a1-001', 'fr-a1-002', 'fr-a1-003', 'fr-a1-004']);
    const lifecycle = columnIndex('lifecycle_status');
    for (const [index, id] of ids.entries()) {
      expect(catalog.get(id)?.[lifecycle]).toBe('active');
      const node = graph.nodes.find((item) => item.skill_id === id);
      expect(node, id).toBeDefined();
      expect(Array.isArray(node?.prerequisites), id).toBe(true);
      for (const prerequisite of node?.prerequisites ?? [])
        expect(ids.slice(0, index)).toContain(prerequisite);
    }
  });

  it('gives every lesson an English explanation, examples and catalog references', () => {
    const sources = columnIndex('source_ids');
    for (const lesson of module.lessons) {
      expect(lesson.title.trim()).not.toBe('');
      expect(lesson.explanation.length).toBeGreaterThan(80);
      expect(lesson.examples.length).toBeGreaterThanOrEqual(3);
      for (const example of lesson.examples) {
        expect(example.fr.trim(), lesson.skill_id).not.toBe('');
        expect(example.en.trim(), lesson.skill_id).not.toBe('');
      }
      const row = catalog.get(lesson.skill_id);
      expect(row, lesson.skill_id).toBeDefined();
      const allowed = String(row?.[sources]).split(';');
      expect(lesson.references.length).toBeGreaterThan(0);
      for (const reference of lesson.references) {
        expect(reference.trim(), lesson.skill_id).not.toBe('');
        expect(allowed).toContain(reference);
      }
      expect(lesson.version).toMatchObject({
        id: `${lesson.skill_id}@1`,
        version: 1
      });
    }
  });

  it('has exactly twelve practice items and three holdouts per skill, in all four formats', () => {
    expect(questions.length).toBe(60);
    for (const q of questions) {
      expect(typeof q.holdout, q.id).toBe('boolean');
      expect(formats, q.id).toContain(q.format);
    }
    for (const lesson of module.lessons) {
      const items = lesson.version.questions;
      const practice = items.filter((q) => !q.holdout);
      const holdouts = items.filter((q) => q.holdout);
      expect(practice.length).toBe(12);
      expect(holdouts.length).toBe(3);
      expect(new Set(practice.map((q) => q.format))).toEqual(new Set(formats));
      expect(new Set(holdouts.map((q) => q.format)).size).toBe(3);
      for (const q of items)
        expect(
          q.id.startsWith(`${lesson.version.id}:${q.holdout ? 'h' : 'q'}`)
        ).toBe(true);
    }
  });

  it('no holdout repeats a practice prompt, answer or accepted alternative in its lesson, and ids and prompts are unique', () => {
    for (const lesson of module.lessons) {
      const items = lesson.version.questions;
      const practice = items.filter((q) => !q.holdout);
      const typed = (q: Question) =>
        q.format === 'multiple-choice'
          ? [q.answer]
          : [q.answer, ...(q.alternatives ?? [])];
      const seen = new Set(
        practice.flatMap((q) => [
          normalize(q.prompt),
          ...typed(q).map(normalize)
        ])
      );
      for (const q of items.filter((item) => item.holdout)) {
        expect(seen.has(normalize(q.prompt)), q.id).toBe(false);
        for (const accepted of typed(q))
          expect(seen.has(normalize(accepted)), `${q.id}: ${accepted}`).toBe(
            false
          );
      }
    }
    const ids = questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    const prompts = questions.map((q) => normalize(q.prompt));
    expect(new Set(prompts).size).toBe(prompts.length);
  });

  it('data consistency: typed answers, alternatives and near misses agree with the local rule, and multiple-choice options are sound', () => {
    for (const q of questions) {
      expect(q.answer.trim(), q.id).not.toBe('');
      for (const alternative of q.alternatives ?? [])
        expect(alternative.trim(), q.id).not.toBe('');
      expect(accepts(q, q.answer), q.id).toBe(true);
      for (const alternative of q.format === 'multiple-choice'
        ? []
        : (q.alternatives ?? []))
        expect(accepts(q, alternative), q.id).toBe(true);
      if (q.format === 'multiple-choice') {
        expect(q.alternatives, q.id).toContain(q.answer);
        expect(q.alternatives?.length, q.id).toBeGreaterThanOrEqual(3);
        const options = (q.alternatives ?? []).map(normalize);
        expect(new Set(options).size, q.id).toBe(options.length);
        expect(
          options.filter((option) => option === normalize(q.answer)),
          q.id
        ).toHaveLength(1);
        continue;
      }
      const accepted = [q.answer, ...(q.alternatives ?? [])].map(normalize);
      expect(new Set(accepted).size, q.id).toBe(accepted.length);
      expect(q.near_misses?.length, q.id).toBeGreaterThan(0);
      for (const miss of q.near_misses ?? [])
        expect(accepts(q, miss), `${q.id}: ${miss}`).toBe(false);
    }
  });

  it('local matching rule: ignores case, spacing, apostrophe style and final punctuation, but not accents', () => {
    const q: Question = {
      id: 'probe',
      format: 'translation',
      prompt: 'I live in Paris.',
      answer: "J'habite à Paris.",
      holdout: false
    };
    const question: Question = {
      ...q,
      answer: 'Est-ce que tu aimes la musique ?'
    };
    expect(accepts(q, '  j’habite   à paris ')).toBe(true);
    expect(accepts(q, "J'habite à Paris!")).toBe(true);
    for (const mark of ['\u2018', '\u2019', '\u02bc', '\u201b'])
      expect(accepts(q, `J${mark}habite à Paris`), mark).toBe(true);
    expect(accepts(question, 'est-ce que tu aimes la musique\u00a0?')).toBe(
      true
    );
    expect(accepts(q, "J'habite a\u0300 Paris".normalize('NFD'))).toBe(true);
    expect(
      accepts({ ...q, format: 'multiple-choice', answer: 'Elle' }, 'elle')
    ).toBe(false);
    expect(accepts(q, "J'habite a Paris")).toBe(false);
    expect(accepts(q, "J'habite à Paris,")).toBe(false);
  });

  it('keeps the module review status and the evidence decision in agreement', () => {
    const decision = {
      'pending-owner-review': 'pending',
      approved: 'approved'
    } as Record<string, string>;
    expect(Object.keys(decision)).toContain(module.review_status);
    const evidence = read('docs/evidence/T101.md');
    expect(evidence.match(/^Reviewer decision:/gmu)).toHaveLength(1);
    expect(evidence).toMatch(
      new RegExp(
        `^## Review\\n+Reviewer decision: ${decision[module.review_status]}\\b`,
        'mu'
      )
    );
  });
});

describe('French A1 module 01 import', () => {
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

  const count = async (table: string) =>
    Number(
      (await client.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n
    );

  it('is refused while unreviewed, and writes nothing', async () => {
    const tables = [
      'skills',
      'prerequisites',
      'content_versions',
      'questions',
      'curriculum_imports'
    ];
    const before = await Promise.all(tables.map(count));
    await expect(
      importContent(
        client,
        modulePackage(
          module.review_status === 'approved'
            ? 'unreviewed'
            : module.review_status
        )
      )
    ).rejects.toMatchObject({ code: 'UNREVIEWED' });
    expect(await Promise.all(tables.map(count))).toEqual(before);
  });

  it("imports with the approved bundle's skills and prerequisites into a fresh database once a review is recorded (ids, formats and counts only: the questions table stores no prompt or answer)", async () => {
    const before = await count('questions');
    const result = await importContent(client, modulePackage('approved'));
    expect(result.versions).toBe(4);
    expect(result.questions).toBe(60);
    const stored = await client.execute(
      'SELECT id, format FROM questions ORDER BY id'
    );
    const expected = questions.map((q) => `${q.id}|${q.format}`).sort();
    expect(
      stored.rows
        .map((row) => `${String(row.id)}|${String(row.format)}`)
        .filter((key) => key.startsWith('fr-a1-'))
        .sort()
    ).toEqual(expected);
    // The importer has no holdout flag: holdouts are stored as ordinary
    // questions, so their separation from practice lives in the module JSON.
    expect((await count('questions')) - before).toBe(questions.length);
    const again = await importContent(client, modulePackage('approved'));
    expect([again.versions, again.questions]).toEqual([0, 0]);
  });

  it('imports the approved bundle first, then the module as a newer curriculum version', async () => {
    await importContent(client, bundlePackage(root));
    const before = await count('questions');
    const result = await importContent(
      client,
      modulePackage('approved', '1.1.0')
    );
    expect([result.skills, result.versions, result.questions]).toEqual([
      0,
      4,
      questions.length
    ]);
    expect((await count('questions')) - before).toBe(questions.length);
  });
});
