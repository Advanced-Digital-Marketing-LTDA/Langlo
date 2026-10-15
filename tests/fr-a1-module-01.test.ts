import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { bundlePackage } from '../src/lib/server/content-bundle';
import {
  ContentImportError,
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

function modulePackage(review: string): ContentPackage {
  const pkg = bundlePackage(root);
  return {
    ...pkg,
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
      const allowed = String(catalog.get(lesson.skill_id)?.[sources]).split(
        ';'
      );
      expect(lesson.references.length).toBeGreaterThan(0);
      for (const reference of lesson.references)
        expect(allowed).toContain(reference);
      expect(lesson.version).toMatchObject({
        id: `${lesson.skill_id}@1`,
        version: 1
      });
    }
  });

  it('has at least twelve practice items and three holdouts per skill, in all four formats', () => {
    expect(questions.length).toBeGreaterThanOrEqual(48);
    for (const lesson of module.lessons) {
      const items = lesson.version.questions;
      const practice = items.filter((q) => !q.holdout);
      const holdouts = items.filter((q) => q.holdout);
      expect(practice.length).toBeGreaterThanOrEqual(12);
      expect(holdouts.length).toBeGreaterThanOrEqual(3);
      expect(new Set(practice.map((q) => q.format))).toEqual(new Set(formats));
      expect(new Set(holdouts.map((q) => q.format)).size).toBeGreaterThan(1);
      for (const q of items)
        expect(q.id.startsWith(`${lesson.version.id}:`)).toBe(true);
    }
  });

  it('keeps holdouts out of practice: no shared prompt or answer', () => {
    for (const lesson of module.lessons) {
      const items = lesson.version.questions;
      const practice = items.filter((q) => !q.holdout);
      const seen = new Set(
        practice.flatMap((q) => [normalize(q.prompt), normalize(q.answer)])
      );
      for (const q of items.filter((item) => item.holdout)) {
        expect(seen.has(normalize(q.prompt)), q.id).toBe(false);
        expect(seen.has(normalize(q.answer)), q.id).toBe(false);
      }
    }
    const ids = questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    const prompts = questions.map((q) => normalize(q.prompt));
    expect(new Set(prompts).size).toBe(prompts.length);
  });

  it('accepts every answer and alternative, and rejects every near miss', () => {
    for (const q of questions) {
      expect(accepts(q, q.answer), q.id).toBe(true);
      for (const alternative of q.format === 'multiple-choice'
        ? []
        : (q.alternatives ?? []))
        expect(accepts(q, alternative), q.id).toBe(true);
      if (q.format === 'multiple-choice') {
        expect(q.alternatives, q.id).toContain(q.answer);
        expect(q.alternatives?.length, q.id).toBeGreaterThanOrEqual(3);
        for (const option of q.alternatives ?? [])
          if (option !== q.answer) expect(accepts(q, option), q.id).toBe(false);
        continue;
      }
      expect(q.near_misses?.length, q.id).toBeGreaterThan(0);
      for (const miss of q.near_misses ?? [])
        expect(accepts(q, miss), `${q.id}: ${miss}`).toBe(false);
    }
  });

  it('ignores case, spacing, apostrophe style and final punctuation, but not accents', () => {
    const q: Question = {
      id: 'probe',
      format: 'translation',
      prompt: 'I am French.',
      answer: "J'habite à Paris.",
      holdout: false
    };
    expect(accepts(q, '  j’habite   à paris ')).toBe(true);
    expect(accepts(q, "J'habite a Paris")).toBe(false);
    expect(accepts(q, "J'habite à Paris,")).toBe(false);
  });

  it('records an owner decision before the module can be approved', () => {
    expect(['pending-owner-review', 'approved']).toContain(
      module.review_status
    );
    const evidence = read('docs/evidence/T101.md');
    expect(evidence).toMatch(/Reviewer decision: (pending|approved)/u);
    if (module.review_status === 'approved')
      expect(evidence).toMatch(/Reviewer decision: approved/u);
    else expect(evidence).toMatch(/Reviewer decision: pending/u);
  });
});

describe('French A1 module 01 import', () => {
  let client: Client;
  let close: (() => void) | undefined;

  beforeEach(async () => {
    ({ client, close } = await openFixtureDatabase(await fixture()));
  });

  afterEach(async () => {
    close?.();
    close = undefined;
    await disposeFlashcardFixtures();
  });

  const count = async (table: string) =>
    Number(
      (await client.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n
    );

  it('is refused while unreviewed, and writes nothing', async () => {
    const tables = ['skills', 'content_versions', 'questions'];
    const before = await Promise.all(tables.map(count));
    const error = (await importContent(
      client,
      modulePackage('unreviewed')
    ).catch((e: unknown) => e)) as ContentImportError;
    expect(error).toBeInstanceOf(ContentImportError);
    expect(error.code).toBe('UNREVIEWED');
    expect(await Promise.all(tables.map(count))).toEqual(before);
  });

  it('imports together with the approved bundle into a fresh database once a review is recorded', async () => {
    const before = await count('questions');
    const result = await importContent(client, modulePackage('approved'));
    expect(result.versions).toBe(4);
    expect(result.questions).toBe(questions.length);
    // The importer has no holdout flag: holdouts are stored as ordinary
    // questions, so their separation from practice lives in the module JSON.
    expect((await count('questions')) - before).toBe(questions.length);
    const again = await importContent(client, modulePackage('approved'));
    expect([again.versions, again.questions]).toEqual([0, 0]);
  });
});
