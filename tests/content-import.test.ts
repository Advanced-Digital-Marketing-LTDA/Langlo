import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import {
  ContentImportError,
  importContent,
  type ContentPackage
} from '../src/lib/server/content-import';
import { disposeFlashcardFixtures, fixture } from './fixtures/flashcards';
import { privateState } from './fixtures/owner-scope';
import { approvedPackage } from './fixtures/content-package';

// T012 importer gates on a disposable fixture database. The package is
// synthetic; passing here proves the gates, not any checked curriculum.

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

async function sharedContent() {
  const results = await client.batch(
    [
      'SELECT id, language, level FROM skills ORDER BY id',
      'SELECT skill_id, prerequisite_id, language FROM prerequisites ORDER BY skill_id, prerequisite_id',
      'SELECT id, skill_id, language, version, status FROM content_versions ORDER BY id',
      'SELECT id, content_version_id, skill_id, language, format FROM questions ORDER BY id'
    ],
    'read'
  );
  return results.map((result) => result.rows.map((row) => ({ ...row })));
}

async function rejects(pkg: ContentPackage, code: string) {
  const before = await sharedContent();
  const error = await importContent(client, pkg).catch((thrown) => thrown);
  expect(error).toBeInstanceOf(ContentImportError);
  expect((error as ContentImportError).code).toBe(code);
  expect(await sharedContent()).toEqual(before);
}

describe('content import', () => {
  it('imports approved skills, prerequisites, versions and questions', async () => {
    const result = await importContent(client, approvedPackage());
    expect(result).toEqual({
      skills: 3,
      prerequisites: 3,
      versions: 2,
      questions: 3,
      quarantined: 0
    });
    const [skills, edges, versions, questions] = await sharedContent();
    expect(skills.map((row) => row.id)).toEqual([
      'fr-a1-001',
      'fr-a1-002',
      'fr-a1-003',
      'fr-articles'
    ]);
    expect(edges).toEqual([
      { skill_id: 'fr-a1-002', prerequisite_id: 'fr-a1-001', language: 'fr' },
      { skill_id: 'fr-a1-003', prerequisite_id: 'fr-a1-001', language: 'fr' },
      { skill_id: 'fr-a1-003', prerequisite_id: 'fr-a1-002', language: 'fr' }
    ]);
    expect(versions).toContainEqual({
      id: 'fr-a1-001@1',
      skill_id: 'fr-a1-001',
      language: 'fr',
      version: 1,
      status: 'schema-validated'
    });
    expect(questions).toContainEqual({
      id: 'fr-a1-001@1:q1',
      content_version_id: 'fr-a1-001@1',
      skill_id: 'fr-a1-001',
      language: 'fr',
      format: 'multiple-choice'
    });
  });

  it('is idempotent: a second import of the same package writes nothing', async () => {
    await importContent(client, approvedPackage());
    const after = await sharedContent();
    expect(await importContent(client, approvedPackage())).toEqual({
      skills: 0,
      prerequisites: 0,
      versions: 0,
      questions: 0,
      quarantined: 0
    });
    expect(await sharedContent()).toEqual(after);
  });

  it('re-imports a version whose question IDs differ only in case', async () => {
    // Binary (SQLite) and locale order disagree on these IDs.
    const pkg = approvedPackage();
    pkg.versions[0].questions[0].id = 'Q-b';
    pkg.versions[0].questions[1].id = 'q-a';
    await importContent(client, pkg);
    expect((await importContent(client, pkg)).versions).toBe(0);
  });

  it('preserves existing prerequisites when a later package omits them', async () => {
    await importContent(client, approvedPackage());
    const later = approvedPackage();
    later.skills[2].prerequisites = ['fr-a1-002'];
    later.versions = [];
    await importContent(client, later);
    const [, edges] = await sharedContent();
    expect(edges).toHaveLength(3);
  });

  it('adds a new version alongside the old one instead of rewriting it', async () => {
    await importContent(client, approvedPackage());
    const next = approvedPackage();
    next.versions = [
      {
        id: 'fr-a1-001@2',
        skillId: 'fr-a1-001',
        version: 2,
        review: 'approved',
        questions: [
          {
            id: 'fr-a1-001@2:q1',
            format: 'correction',
            prompt: 'Je es là.',
            answer: 'Je suis là.'
          }
        ]
      }
    ];
    expect((await importContent(client, next)).versions).toBe(1);
    const [, , versions] = await sharedContent();
    expect(
      versions
        .filter((row) => row.skill_id === 'fr-a1-001')
        .map((row) => row.id)
    ).toEqual(['fr-a1-001@1', 'fr-a1-001@2']);
  });

  it('quarantines an imported version and never un-quarantines it', async () => {
    await importContent(client, approvedPackage());
    const pulled = approvedPackage();
    pulled.versions[0].review = 'quarantined';
    expect((await importContent(client, pulled)).quarantined).toBe(1);
    expect((await importContent(client, approvedPackage())).quarantined).toBe(
      0
    );
    const [, , versions] = await sharedContent();
    expect(versions.find((row) => row.id === 'fr-a1-001@1')?.status).toBe(
      'quarantined'
    );
  });

  it('never creates cards, review history or learner progress', async () => {
    const before = await privateState(client);
    await importContent(client, approvedPackage());
    expect(await privateState(client)).toEqual(before);
  });
});

describe('content import rejects the whole package', () => {
  it('when the package is not approved', async () => {
    const pkg = approvedPackage();
    pkg.publicationStatus = 'draft';
    await rejects(pkg, 'NOT_APPROVED');
  });

  it('when the curriculum version is not a stable semantic version', async () => {
    for (const version of ['draft', '1.0.0-beta.1', '01.0.0', '1.0', '']) {
      const pkg = approvedPackage();
      pkg.curriculumVersion = version;
      await rejects(pkg, 'NOT_APPROVED');
    }
  });

  it('when a skill is outside the supported tracks', async () => {
    const pkg = approvedPackage();
    pkg.skills.push({
      id: 'fr-a2-001',
      language: 'fr',
      level: 'A2',
      review: 'approved',
      prerequisites: []
    });
    await rejects(pkg, 'INVALID_PACKAGE');
  });

  it('when a skill lists the same prerequisite twice', async () => {
    const pkg = approvedPackage();
    pkg.skills[2].prerequisites = ['fr-a1-001', 'fr-a1-001'];
    await rejects(pkg, 'INVALID_PACKAGE');
  });

  it('when edges are given another meaning than teaching order', async () => {
    const pkg = approvedPackage();
    pkg.dependencySemantics = 'mastery_gate';
    await rejects(pkg, 'INVALID_PACKAGE');
  });

  it('when any skill or version is unreviewed', async () => {
    const skill = approvedPackage();
    skill.skills[1].review = 'provisional';
    await rejects(skill, 'UNREVIEWED');
    const version = approvedPackage();
    version.versions[1].review = 'draft';
    await rejects(version, 'UNREVIEWED');
  });

  it('when a prerequisite or version names a missing skill', async () => {
    const edge = approvedPackage();
    edge.skills[1].prerequisites = ['fr-a1-404'];
    await rejects(edge, 'MISSING_REFERENCE');
    const version = approvedPackage();
    version.versions[0].skillId = 'fr-a1-404';
    await rejects(version, 'MISSING_REFERENCE');
  });

  it('when prerequisites form a cycle, including through stored edges', async () => {
    const pkg = approvedPackage();
    pkg.skills[0].prerequisites = ['fr-a1-003'];
    await rejects(pkg, 'PREREQUISITE_CYCLE');
    const self = approvedPackage();
    self.skills[0].prerequisites = ['fr-a1-001'];
    await rejects(self, 'PREREQUISITE_CYCLE');

    await importContent(client, approvedPackage());
    const later = approvedPackage();
    later.skills = [{ ...later.skills[0], prerequisites: ['fr-a1-002'] }];
    later.versions = [];
    await rejects(later, 'PREREQUISITE_CYCLE');
  });

  it('when an edge crosses languages or runs from a higher level to a lower one', async () => {
    const cross = approvedPackage();
    cross.skills.push({
      id: 'de-a1-001',
      language: 'de',
      level: 'A1',
      review: 'approved',
      prerequisites: ['fr-a1-001']
    });
    await rejects(cross, 'INVALID_PREREQUISITE');
    const level = approvedPackage();
    level.skills.push(
      {
        id: 'de-a1-001',
        language: 'de',
        level: 'A1',
        review: 'approved',
        prerequisites: ['de-a2-001']
      },
      {
        id: 'de-a2-001',
        language: 'de',
        level: 'A2',
        review: 'approved',
        prerequisites: []
      }
    );
    await rejects(level, 'INVALID_PREREQUISITE');
  });

  it('when question alternatives are invalid', async () => {
    const cases: Array<(pkg: ContentPackage) => void> = [
      (pkg) => (pkg.versions[0].questions[0].alternatives = ['suis']),
      (pkg) => (pkg.versions[0].questions[0].alternatives = ['es', 'est']),
      (pkg) =>
        (pkg.versions[0].questions[0].alternatives = ['suis', 'es', 'Es ']),
      (pkg) => (pkg.versions[0].questions[0].alternatives = undefined),
      (pkg) => (pkg.versions[0].questions[1].alternatives = ['es']),
      (pkg) => (pkg.versions[0].questions[1].alternatives = ['', 'sois'])
    ];
    for (const change of cases) {
      const pkg = approvedPackage();
      change(pkg);
      await rejects(pkg, 'INVALID_ALTERNATIVES');
    }
  });

  it('when a question is malformed or a version has none', async () => {
    const empty = approvedPackage();
    empty.versions[1].questions = [];
    await rejects(empty, 'INVALID_PACKAGE');
    const format = approvedPackage();
    (format.versions[0].questions[1] as { format: string }).format = 'essay';
    await rejects(format, 'INVALID_PACKAGE');
    const prompt = approvedPackage();
    prompt.versions[0].questions[1].prompt = ' ';
    await rejects(prompt, 'INVALID_PACKAGE');
    const duplicate = approvedPackage();
    duplicate.versions[1].questions[0].id = 'fr-a1-001@1:q1';
    await rejects(duplicate, 'INVALID_PACKAGE');
  });

  it('when it would rewrite a stored skill, version or question', async () => {
    await importContent(client, approvedPackage());
    const skill = approvedPackage();
    skill.skills[0].language = 'de';
    skill.skills[1].language = 'de';
    skill.skills[2].language = 'de';
    skill.versions = [];
    await rejects(skill, 'CONTENT_CONFLICT');
    const question = approvedPackage();
    question.versions[0].questions[1].format = 'translation';
    await rejects(question, 'CONTENT_CONFLICT');
    const added = approvedPackage();
    added.versions[0].questions.push({
      id: 'fr-a1-001@1:q3',
      format: 'typed-blank',
      prompt: 'Il ___ là.',
      answer: 'est'
    });
    await rejects(added, 'CONTENT_CONFLICT');
    const renumbered = approvedPackage();
    renumbered.versions[0].id = 'fr-a1-001@1b';
    renumbered.versions[0].questions = [
      {
        id: 'fr-a1-001@1b:q1',
        format: 'typed-blank',
        prompt: 'x ___',
        answer: 'y'
      }
    ];
    await rejects(renumbered, 'CONTENT_CONFLICT');
  });
});
