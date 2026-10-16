import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { importContent } from '../src/lib/server/content-import';
import { columnIndex, parseCsv } from '../scripts/curriculum-contract.mjs';
import {
  accepts,
  formats,
  modulePackage,
  normalize,
  typedAnswers,
  type Module
} from './fixtures/curriculum-module';
import { disposeFlashcardFixtures, fixture } from './fixtures/flashcards';

// Authored curriculum modules after French A1 module 01 (which keeps its own
// test): every module is checked against the approved bundle, the local
// answer-matching rule and the importer. Add a module by adding its JSON file
// under content/<track>/ and an evidence file under docs/evidence/modules/.

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const files = readdirSync(join(root, 'content'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((dir) =>
    readdirSync(join(root, 'content', dir.name))
      .filter((name) => /^module-\d+\.json$/u.test(name))
      .map((name) => `content/${dir.name}/${name}`)
  )
  .filter((path) => path !== 'content/fr-a1/module-01.json')
  .sort();

const graph = JSON.parse(read('content/prerequisites.json')) as {
  nodes: { skill_id: string; prerequisites: string[] }[];
};
const catalog = new Map(
  parseCsv(read('docs/curriculum-coverage.csv'))
    .slice(1)
    .map((row) => [row[0], row])
);
const load = (path: string) => JSON.parse(read(path)) as Module;
const allModules = readdirSync(join(root, 'content'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((dir) =>
    readdirSync(join(root, 'content', dir.name))
      .filter((name) => /^module-\d+\.json$/u.test(name))
      .map((name) => `content/${dir.name}/${name}`)
  )
  .sort()
  .map(load);

const packageFor = (module: Module, review: string, version?: string) =>
  modulePackage(root, module, review, version);

it('finds the authored modules this suite covers', () => {
  expect(files.length).toBeGreaterThan(0);
});

describe.each(files)('%s', (path) => {
  const module = load(path);
  const questions = module.lessons.flatMap(
    (lesson) => lesson.version.questions
  );

  it('covers active catalog skills of its track in prerequisite order', () => {
    expect(module.instruction_language).toBe('en');
    expect(module.matching).toBe(allModules[0].matching);
    const track = module.lessons[0].skill_id.replace(/-\d+$/u, '');
    const authoredBefore = new Set(
      allModules
        .filter((other) => other.module_id < module.module_id)
        .flatMap((other) => other.lessons.map((lesson) => lesson.skill_id))
    );
    const lifecycle = columnIndex('lifecycle_status');
    const level = columnIndex('level');
    const language = columnIndex('language');
    const ids = module.lessons.map((lesson) => lesson.skill_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [index, id] of ids.entries()) {
      expect(id.startsWith(`${track}-`), id).toBe(true);
      const row = catalog.get(id);
      expect(row?.[lifecycle], id).toBe('active');
      expect(`${row?.[language]} ${row?.[level]}`, id).toBe(module.track);
      expect(authoredBefore.has(id), `${id} already authored`).toBe(false);
      const node = graph.nodes.find((item) => item.skill_id === id);
      expect(node, id).toBeDefined();
      for (const prerequisite of node?.prerequisites ?? []) {
        const earlier = [...authoredBefore, ...ids.slice(0, index)];
        expect(earlier, `${id} needs ${prerequisite}`).toContain(prerequisite);
      }
    }
  });

  it('gives every lesson an English explanation, examples and catalog references', () => {
    const sources = columnIndex('source_ids');
    for (const lesson of module.lessons) {
      expect(lesson.title.trim()).not.toBe('');
      expect(lesson.explanation.length).toBeGreaterThan(80);
      expect(lesson.examples.length).toBeGreaterThanOrEqual(3);
      for (const example of lesson.examples) {
        const target = example.fr ?? example.de ?? '';
        expect(target.trim(), lesson.skill_id).not.toBe('');
        expect(example.en.trim(), lesson.skill_id).not.toBe('');
      }
      const allowed = String(catalog.get(lesson.skill_id)?.[sources]).split(
        ';'
      );
      expect(lesson.references.length).toBeGreaterThan(0);
      for (const reference of lesson.references) {
        expect(allowed).toContain(reference);
      }
      expect(lesson.version).toMatchObject({
        id: `${lesson.skill_id}@1`,
        version: 1
      });
    }
  });

  it('has twelve practice items and three holdouts per skill, in all four formats', () => {
    for (const q of questions) {
      expect(typeof q.holdout, q.id).toBe('boolean');
      expect(formats, q.id).toContain(q.format);
    }
    for (const lesson of module.lessons) {
      const items = lesson.version.questions;
      const practice = items.filter((q) => !q.holdout);
      const holdouts = items.filter((q) => q.holdout);
      expect(practice.length, lesson.skill_id).toBe(12);
      expect(holdouts.length, lesson.skill_id).toBe(3);
      expect(new Set(practice.map((q) => q.format))).toEqual(new Set(formats));
      for (const format of formats)
        expect(
          practice.filter((q) => q.format === format).length,
          `${lesson.skill_id} ${format}`
        ).toBeGreaterThanOrEqual(2);
      expect(new Set(holdouts.map((q) => q.format)).size).toBe(3);
      for (const q of items)
        expect(
          q.id.startsWith(`${lesson.version.id}:${q.holdout ? 'h' : 'q'}`),
          q.id
        ).toBe(true);
    }
  });

  it('no holdout repeats a practice prompt, typed answer, accepted alternative or lesson example, and ids and prompts are unique', () => {
    const seen = new Set(
      module.lessons.flatMap((lesson) => [
        ...lesson.examples.map((example) =>
          normalize(example.fr ?? example.de ?? '')
        ),
        ...lesson.version.questions
          .filter((q) => !q.holdout)
          .flatMap((q) => [
            normalize(q.prompt),
            ...typedAnswers(q).map(normalize)
          ])
      ])
    );
    for (const q of questions.filter((item) => item.holdout)) {
      expect(seen.has(normalize(q.prompt)), q.id).toBe(false);
      for (const accepted of typedAnswers(q))
        expect(seen.has(normalize(accepted)), `${q.id}: ${accepted}`).toBe(
          false
        );
    }
    const ids = questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    const prompts = questions.map((q) => normalize(q.prompt));
    expect(new Set(prompts).size).toBe(prompts.length);
  });

  it('data consistency: answers, alternatives and near misses agree with the local rule, and multiple-choice options are sound', () => {
    for (const q of questions) {
      expect(q.answer.trim(), q.id).not.toBe('');
      if (q.format === 'multiple-choice') {
        expect(q.alternatives, q.id).toContain(q.answer);
        expect(q.alternatives?.length, q.id).toBeGreaterThanOrEqual(3);
        const options = (q.alternatives ?? []).map(normalize);
        expect(new Set(options).size, q.id).toBe(options.length);
        continue;
      }
      for (const alternative of q.alternatives ?? [])
        expect(alternative.trim(), q.id).not.toBe('');
      const accepted = typedAnswers(q).map(normalize);
      expect(new Set(accepted).size, q.id).toBe(accepted.length);
      expect(q.near_misses?.length, q.id).toBeGreaterThan(0);
      for (const miss of q.near_misses ?? []) {
        expect(miss.trim(), q.id).not.toBe('');
        expect(accepts(q, miss), `${q.id}: ${miss}`).toBe(false);
      }
      const misses = (q.near_misses ?? []).map(normalize);
      expect(new Set(misses).size, q.id).toBe(misses.length);
    }
  });

  it('keeps the module review status and the evidence decision in agreement', () => {
    const decisions = {
      'pending-owner-review': 'pending',
      approved: 'approved'
    } as const;
    const status = module.review_status as keyof typeof decisions;
    expect(Object.keys(decisions)).toContain(status);
    const evidence = read(`docs/evidence/modules/${module.module_id}.md`);
    expect(evidence.match(/^Reviewer decision:/gmu)).toHaveLength(1);
    expect(evidence).toMatch(
      new RegExp(`^Reviewer decision: ${decisions[status]}\\.`, 'mu')
    );
  });

  describe('import', () => {
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
      const tables = ['content_versions', 'questions', 'curriculum_imports'];
      const before = await Promise.all(tables.map(count));
      for (const review of ['unreviewed', 'pending-owner-review']) {
        await expect(
          importContent(client, packageFor(module, review)),
          review
        ).rejects.toMatchObject({ code: 'UNREVIEWED' });
        expect(await Promise.all(tables.map(count)), review).toEqual(before);
      }
    });

    it('imports once reviewed, and a second import adds nothing', async () => {
      const result = await importContent(
        client,
        packageFor(module, 'approved')
      );
      expect([result.versions, result.questions]).toEqual([
        module.lessons.length,
        questions.length
      ]);
      const again = await importContent(client, packageFor(module, 'approved'));
      expect([again.versions, again.questions]).toEqual([0, 0]);
    });
  });
});
