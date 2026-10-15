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
    let edges = 0;
    for (const [index, id] of ids.entries()) {
      expect(catalog.get(id)?.[lifecycle]).toBe('active');
      const node = graph.nodes.find((item) => item.skill_id === id);
      expect(node, id).toBeDefined();
      expect(Array.isArray(node?.prerequisites), id).toBe(true);
      for (const prerequisite of node?.prerequisites ?? []) {
        expect(ids.slice(0, index)).toContain(prerequisite);
        edges += 1;
      }
    }
    expect(edges).toBeGreaterThan(0);
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
      if (q.format === 'translation')
        expect(q.prompt, q.id).toMatch(
          /^Translate \(use the simple present\): /u
        );
    }
    for (const lesson of module.lessons) {
      const items = lesson.version.questions;
      const practice = items.filter((q) => !q.holdout);
      const holdouts = items.filter((q) => q.holdout);
      expect(practice.length).toBe(12);
      expect(holdouts.length).toBe(3);
      expect(new Set(practice.map((q) => q.format))).toEqual(new Set(formats));
      for (const format of formats)
        expect(
          practice.filter((q) => q.format === format).length,
          `${lesson.skill_id} ${format}`
        ).toBeGreaterThanOrEqual(2);
      expect(new Set(holdouts.map((q) => q.format)).size).toBe(3);
      for (const q of items)
        expect(
          q.id.startsWith(`${lesson.version.id}:${q.holdout ? 'h' : 'q'}`)
        ).toBe(true);
    }
  });

  it('no holdout repeats a practice prompt, typed answer, accepted alternative or lesson example anywhere in the module (multiple-choice options are not compared), and ids and prompts are unique', () => {
    const typed = (q: Question) =>
      q.format === 'multiple-choice'
        ? [q.answer]
        : [q.answer, ...(q.alternatives ?? [])];
    const seen = new Set(
      module.lessons.flatMap((lesson) => [
        ...lesson.examples.map((example) => normalize(example.fr)),
        ...lesson.version.questions
          .filter((q) => !q.holdout)
          .flatMap((q) => [normalize(q.prompt), ...typed(q).map(normalize)])
      ])
    );
    const holdouts = questions.filter((q) => q.holdout);
    expect(holdouts.length).toBeGreaterThan(0);
    for (const q of holdouts) {
      expect(seen.has(normalize(q.prompt)), q.id).toBe(false);
      for (const accepted of typed(q))
        expect(seen.has(normalize(accepted)), `${q.id}: ${accepted}`).toBe(
          false
        );
    }
    const ids = questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    const prompts = questions.map((q) => normalize(q.prompt));
    expect(new Set(prompts).size).toBe(prompts.length);
  });

  it('data consistency: typed answers, alternatives and near misses agree with the local rule, and multiple-choice options are sound', () => {
    expect(questions.length).toBeGreaterThan(0);
    for (const q of questions) {
      expect(q.answer.trim(), q.id).not.toBe('');
      for (const alternative of q.alternatives ?? [])
        expect(alternative.trim(), q.id).not.toBe('');
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
      for (const miss of q.near_misses ?? [])
        expect(miss.trim(), q.id).not.toBe('');
      const misses = (q.near_misses ?? []).map(normalize);
      expect(new Set(misses).size, q.id).toBe(misses.length);
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
    expect(accepts(q, "J'HABITE À PARIS")).toBe(true);
    expect(accepts(q, "J'habite à Paris?!")).toBe(true);
    expect(accepts(q, "J'habite. à Paris")).toBe(false);
    for (const mark of ['\u2018', '\u2019', '\u02bc', '\u201b'])
      expect(accepts(q, `J${mark}habite à Paris`), mark).toBe(true);
    expect(accepts(question, 'est-ce que tu aimes la musique\u00a0?')).toBe(
      true
    );
    expect(accepts(q, "J'habite a\u0300 Paris".normalize('NFD'))).toBe(true);
    expect(
      accepts({ ...q, format: 'multiple-choice', answer: 'Elle' }, 'elle')
    ).toBe(false);
    expect(
      accepts({ ...q, format: 'multiple-choice', answer: 'Elle' }, 'Elle.')
    ).toBe(false);
    expect(accepts(q, "J'habite a Paris")).toBe(false);
    expect(accepts(q, "J'habite à Paris,")).toBe(false);
  });

  it('keeps the module review status and the evidence decision in agreement', () => {
    const decisions = {
      'pending-owner-review': 'pending',
      approved: 'approved'
    } as const;
    const status = module.review_status as keyof typeof decisions;
    expect(Object.keys(decisions)).toContain(status);
    const evidence = read('docs/evidence/T101.md');
    expect(evidence.match(/^Reviewer decision:/gmu)).toHaveLength(1);
    expect(evidence).toMatch(
      new RegExp(
        `^## Review\\n+Reviewer decision: ${decisions[status]}\\.`,
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
    for (const review of ['unreviewed', 'pending-owner-review']) {
      await expect(
        importContent(client, modulePackage(review)),
        review
      ).rejects.toMatchObject({
        code: 'UNREVIEWED',
        detail: module.lessons[0].version.id
      });
      expect(await Promise.all(tables.map(count)), review).toEqual(before);
    }
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
    // The importer has no holdout flag (LANGLO-125): holdouts are stored as ordinary
    // questions, so their separation from practice lives in the module JSON.
    expect((await count('questions')) - before).toBe(questions.length);
    const again = await importContent(client, modulePackage('approved'));
    expect([again.versions, again.questions]).toEqual([0, 0]);
  });

  it('refuses the module under the already imported 1.0.0 curriculum version, and writes nothing', async () => {
    await importContent(client, bundlePackage(root));
    const tables = ['skills', 'content_versions', 'questions'];
    const before = await Promise.all(tables.map(count));
    await expect(
      importContent(client, modulePackage('approved'))
    ).rejects.toMatchObject({ code: 'CONTENT_CONFLICT' });
    expect(await Promise.all(tables.map(count))).toEqual(before);
  });

  it('imports the approved bundle first, then the module as a newer curriculum version', async () => {
    const bundle = bundlePackage(root);
    const [major, minor] = bundle.curriculumVersion.split('.').map(Number);
    const newer = `${major}.${minor + 1}.0`;
    await importContent(client, bundle);
    const before = await count('questions');
    const result = await importContent(
      client,
      modulePackage('approved', newer)
    );
    expect([result.skills, result.versions, result.questions]).toEqual([
      0,
      4,
      questions.length
    ]);
    expect((await count('questions')) - before).toBe(questions.length);
    const imports = await client.execute(
      'SELECT curriculum_version FROM curriculum_imports ORDER BY curriculum_version'
    );
    const versions = imports.rows.map((row) => String(row.curriculum_version));
    expect(versions).toContain(bundle.curriculumVersion);
    expect(versions).toContain(newer);
  });
});
