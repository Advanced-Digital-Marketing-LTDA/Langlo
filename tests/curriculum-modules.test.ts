import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importContent } from '../src/lib/server/content-import';
import { columnIndex, parseCsv } from '../scripts/curriculum-contract.mjs';
import {
  accepts,
  assertUniqueQuestions,
  moduleImportFixture,
  formats,
  modulePackage,
  normalize,
  typedAnswers,
  type Module
} from './fixtures/curriculum-module';

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
// The practised language's own text: English tracks carry only `en`.
const practisedText = (
  module: Module,
  example: Module['lessons'][number]['examples'][number]
) =>
  module.track.startsWith('French')
    ? (example.fr ?? '')
    : module.track.startsWith('German')
      ? (example.de ?? '')
      : module.track.startsWith('Portuguese')
        ? (example.pt ?? '')
        : example.en;
const load = (path: string) => JSON.parse(read(path)) as Module;
const revisedSkills = new Set([
  'de-a1-001',
  'de-a1-010',
  'de-a1-021',
  'de-a2-002',
  'de-a2-005',
  'de-a2-006',
  'de-a2-007',
  'de-a2-009',
  'de-a2-010',
  'de-a2-011',
  'fr-a1-007',
  'fr-a1-017',
  'fr-a1-019',
  'fr-a1-021',
  'fr-a1-023',
  'fr-a1-024'
]);
const allModules = readdirSync(join(root, 'content'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((dir) =>
    readdirSync(join(root, 'content', dir.name))
      .filter((name) => /^module-\d+\.json$/u.test(name))
      .map((name) => `content/${dir.name}/${name}`)
  )
  .sort()
  .map(load);

const practiceText = (module: Module) =>
  module.lessons
    .flatMap((lesson) => [
      ...lesson.examples.map((example) => practisedText(module, example)),
      ...lesson.version.questions
        .filter((q) => !q.holdout)
        .flatMap((q) => [q.prompt, ...typedAnswers(q)])
    ])
    .map(normalize);

it('finds the authored modules this suite covers', () => {
  expect(files.length).toBeGreaterThan(0);
});

// A Portuguese track in the catalog has a lesson for every active skill, so a
// renamed or deleted module file cannot silently leave skills without lessons.
it('has a lesson for every active Portuguese skill and no others', () => {
  const language = columnIndex('language');
  const level = columnIndex('level');
  const lifecycle = columnIndex('lifecycle_status');
  const rows = [...catalog.values()].filter(
    (row) => row[language] === 'Portuguese'
  );
  const tracks = new Set(rows.map((row) => `Portuguese ${row[level]}`));
  expect(tracks.size).toBeGreaterThan(0);
  for (const track of tracks) {
    const expected = rows
      .filter(
        (row) =>
          `Portuguese ${row[level]}` === track && row[lifecycle] === 'active'
      )
      .map((row) => row[0])
      .sort();
    const authored = allModules
      .filter((module) => module.track === track)
      .flatMap((module) => module.lessons.map((lesson) => lesson.skill_id))
      .sort();
    expect(authored, track).toEqual(expected);
  }
});

describe('reviewed curriculum answer keys', () => {
  const questions = allModules.flatMap((module) =>
    module.lessons.flatMap((lesson) => lesson.version.questions)
  );
  const question = (id: string) => {
    const item = questions.find((q) => q.id === id);
    expect(item, id).toBeDefined();
    return item!;
  };

  it.each([
    ['fr-a1-021@2:q09', 'Hier, nous avons parlé.'],
    ['fr-a1-021@2:q10', 'À midi, elle est arrivée.'],
    ['fr-a1-023@2:q08', 'Je me lève à 7 heures.'],
    ['fr-a1-024@2:q08', 'Dans le jardin, il y a un chat.'],
    ['de-a1-001@2:q08', 'In Bonn arbeitet Anna.'],
    ['de-a1-001@2:q09', 'Paul lernt morgen Deutsch.'],
    ['de-a1-021@2:q07', 'gerne'],
    ['de-a2-005@2:q10', 'Anna lernt Deutsch, weil sie in Wien lebt.'],
    ['de-a2-006@2:q08', 'Ich weiß, dass Anna in Wien lebt.'],
    ['de-a2-006@2:q10', 'Ich glaube, dass das Buch gut ist.'],
    ['de-a2-007@2:q10', 'Sie fragt, wann der Kurs beginnt.'],
    ['de-a2-009@2:q08', 'Das Buch ist auf dem Tisch.'],
    ['de-a2-009@2:q12', 'Er geht ins Haus.'],
    ['de-a2-010@2:q08', 'Wir geben ihr eine Blume.'],
    ['de-a2-011@2:q09', 'Wir treffen uns um 8 Uhr.'],
    ['de-a2-017@1:h03', 'Ich arbeite vor dem Abendessen.'],
    ['de-a2-019@1:q07', 'darum'],
    ['de-a2-019@1:q07', 'daher'],
    ['de-a2-019@1:q07', 'deswegen'],
    ['de-a2-021@1:q08', 'Es wird morgen regnen.'],
    ['de-a2-023@1:q08', 'Ich spiele Tennis gern.'],
    ['en-a2-014@1:q04', 'Because I was ill, I stayed home.'],
    ['en-a2-023@1:h02', 'to get'],
    ['en-a2-017@1:q05', 'present'],
    ['en-a2-017@1:q06', 'past'],
    ['en-a2-017@1:q07', 'Orwell'],
    ['en-a2-017@1:q08', 'People speak English here.'],
    ['en-a2-017@1:q09', 'Someone broke the window yesterday.'],
    ['en-a2-017@1:q10', 'Orwell wrote the book.'],
    ['en-a2-017@1:q11', 'Someone makes the cakes every day.'],
    ['en-a2-017@1:q12', 'Tom cleaned the room yesterday.'],
    ['en-a2-017@1:h02', 'letters'],
    ['en-a2-017@1:h03', 'People make cars in this factory.']
  ])('%s accepts the valid response %s', (id, response) => {
    expect(accepts(question(id), response)).toBe(true);
  });

  it('states the intended tense or modal when other grammatical forms fit', () => {
    for (const id of ['de-a2-002@2:q06', 'de-a2-002@2:q07'])
      expect(question(id).prompt, id).toMatch(/gestern|past|Präteritum/u);
    expect(question('de-a2-006@2:q07').prompt).toMatch(/Anna/u);
    expect(question('de-a2-015@1:q07').prompt).toMatch(/rather|prefer/u);
    expect(question('en-a2-003@1:q06').prompt).toMatch(/ever/u);
    expect(question('en-a2-005@1:q07').prompt).toMatch(/will/u);
    expect(question('en-a2-007@1:q06').prompt).toMatch(/past|yesterday|last/u);
    expect(question('en-a2-007@1:q07').prompt).toMatch(/could/u);
    expect(question('en-a2-009@1:q10').prompt).toMatch(/with need to/u);
    for (const id of ['en-a2-022@1:q08', 'en-a2-022@1:h03'])
      expect(question(id).prompt, id).toMatch(/past/u);
    expect(question('en-a2-022@1:q09').prompt).toMatch(/present continuous/u);
    expect(question('en-a2-022@1:q04').prompt).toMatch(/base verb/u);
    expect(question('en-a2-022@1:q12').near_misses).not.toContain(
      'I saved money for buying a bike.'
    );
    expect(question('en-a2-011@1:q01').alternatives).not.toContain('tallest');
  });

  it('keeps dative recognition inside the catalogued frequent frames', () => {
    for (const id of ['de-a1-010@2:q01', 'de-a1-010@2:q02', 'de-a1-010@2:h01'])
      expect(question(id).prompt, id).toMatch(/mit|hilft|gehört|gefällt/u);
  });

  it('applies the declared English matching rule to real imperative items', () => {
    const item = question('en-a1-017@1:q09');
    for (const response of [
      'Don’t talk in class',
      "DON'T TALK IN CLASS",
      'Do not talk in class.'
    ])
      expect(accepts(item, response), response).toBe(true);
    expect(accepts(item, 'Not talk in class.')).toBe(false);
  });
});

describe.each(files)('%s', (path) => {
  const module = load(path);
  const questions = module.lessons.flatMap(
    (lesson) => lesson.version.questions
  );

  it('binds the module identity to its track and filename', () => {
    expect(module.module_id).toBe(
      path
        .slice('content/'.length)
        .replace('/', '-')
        .replace(/\.json$/u, '')
    );
  });

  it('covers active catalog skills of its track in prerequisite order', () => {
    expect(module.instruction_language).toBe('en');
    expect(module.matching).toBe(load('content/fr-a1/module-01.json').matching);
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
        const target = practisedText(module, example);
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
        id: `${lesson.skill_id}@${lesson.version.version}`
      });
      expect(Number.isSafeInteger(lesson.version.version)).toBe(true);
      expect(lesson.version.version).toBeGreaterThan(0);
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
    const seen = new Set(practiceText(module));
    const trackPractice = new Set(
      allModules
        .filter((other) => other.track === module.track)
        .flatMap(practiceText)
    );
    for (const q of questions.filter((item) => item.holdout)) {
      expect(seen.has(normalize(q.prompt)), q.id).toBe(false);
      for (const accepted of typedAnswers(q))
        expect(seen.has(normalize(accepted)), `${q.id}: ${accepted}`).toBe(
          false
        );
      // Single-word forms may recur across modules; complete assessment sentences may not.
      for (const accepted of typedAnswers(q).filter(
        (text) => normalize(text).includes(' ') && /[.!?]$/u.test(text)
      ))
        expect(
          trackPractice.has(normalize(accepted)),
          `${q.id}: ${accepted}`
        ).toBe(false);
      if (q.format !== 'multiple-choice') {
        for (const accepted of typedAnswers(q).filter((text) =>
          text.includes(' ')
        )) {
          for (const lesson of module.lessons)
            expect(
              normalize(lesson.explanation).includes(normalize(accepted)),
              `${q.id}: explanation copies ${accepted}`
            ).toBe(false);
        }
      }
    }
    assertUniqueQuestions(questions);
  });

  it('data consistency: answers, alternatives and near misses agree with the local rule, and multiple-choice options are sound', () => {
    for (const q of questions) {
      expect(q.answer.trim(), q.id).not.toBe('');
      for (const alternative of q.alternatives ?? [])
        expect(alternative.trim(), q.id).not.toBe('');
      if (q.format === 'multiple-choice') {
        expect(q.alternatives, q.id).toContain(q.answer);
        expect(q.alternatives?.length, q.id).toBeGreaterThanOrEqual(3);
        const options = (q.alternatives ?? []).map(normalize);
        expect(new Set(options).size, q.id).toBe(options.length);
        continue;
      }
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
    const db = moduleImportFixture();
    const count = db.count;

    if (module.lessons.some((lesson) => revisedSkills.has(lesson.skill_id))) {
      it('imports corrected revisions alongside historical version and question IDs', async () => {
        const historical = modulePackage(
          root,
          module,
          module.review_status,
          '1.0.0'
        );
        const revised = historical.versions.filter((version) =>
          revisedSkills.has(version.skillId)
        );
        for (const version of revised) {
          version.id = `${version.skillId}@1`;
          version.version = 1;
          version.questions = [
            {
              ...version.questions[0],
              id: `${version.skillId}@1:q01`,
              prompt: 'Synthetic historical question, not released curriculum.'
            }
          ];
        }
        await importContent(db.client, historical);
        const before = (
          await db.client.execute('SELECT * FROM content_versions ORDER BY id')
        ).rows;
        const oldQuestions = (
          await db.client.execute('SELECT * FROM questions ORDER BY id')
        ).rows;
        const corrected = modulePackage(
          root,
          module,
          module.review_status,
          '1.1.0'
        );
        // A correction follows the historical version, so it declares itself.
        for (const version of corrected.versions)
          if (revisedSkills.has(version.skillId))
            for (const question of version.questions) question.change = 'new';
        const result = await importContent(db.client, corrected);
        expect(result.versions).toBe(revised.length);
        expect(result.questions).toBe(revised.length * 15);
        expect(
          (
            await db.client.execute(
              'SELECT * FROM content_versions ORDER BY id'
            )
          ).rows
        ).toEqual(expect.arrayContaining(before));
        expect(
          (await db.client.execute('SELECT * FROM questions ORDER BY id')).rows
        ).toEqual(expect.arrayContaining(oldQuestions));
        for (const lesson of module.lessons.filter((lesson) =>
          revisedSkills.has(lesson.skill_id)
        ))
          expect(lesson.version).toMatchObject({
            id: `${lesson.skill_id}@2`,
            version: 2
          });
      });
    }

    it('is refused while unreviewed, and writes nothing', async () => {
      const tables = [
        'skills',
        'prerequisites',
        'content_versions',
        'questions',
        'curriculum_imports'
      ] as const;
      const before = await Promise.all(tables.map(count));
      for (const review of ['unreviewed', 'pending-owner-review']) {
        await expect(
          importContent(
            db.client,
            modulePackage(root, { ...module, review_status: review })
          ),
          review
        ).rejects.toMatchObject({ code: 'UNREVIEWED' });
        expect(await Promise.all(tables.map(count)), review).toEqual(before);
      }
    });

    it('imports once reviewed, and a second import adds nothing', async () => {
      const result = await importContent(
        db.client,
        modulePackage(root, module)
      );
      expect([result.versions, result.questions]).toEqual([
        module.lessons.length,
        questions.length
      ]);
      const again = await importContent(db.client, modulePackage(root, module));
      expect([again.versions, again.questions]).toEqual([0, 0]);
    });
  });
});
