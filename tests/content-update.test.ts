import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import {
  ContentImportError,
  importContent,
  type ContentPackage,
  type ContentQuestion
} from '../src/lib/server/content-import';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession
} from './fixtures/flashcards';
import { contentImpact } from '../src/lib/server/content-impact';
import { recordAttempt } from '../src/lib/server/study';
import { approvedPackage } from './fixtures/content-package';

// LANGLO-167: rules for updating content that is already imported. The base
// package is synthetic (fr-a1-001@1 has q1 and q2); each test imports it, then
// tries an update.

let client: Client;
let close: (() => void) | undefined;

beforeEach(async () => {
  ({ client, close } = await openFixtureDatabase(await fixture()));
  await importContent(client, approvedPackage());
});

afterEach(async () => {
  close?.();
  close = undefined;
  await disposeFlashcardFixtures();
});

const question = (
  id: string,
  extra: Partial<ContentQuestion> = {}
): ContentQuestion => ({
  id,
  format: 'typed-blank',
  prompt: `Prompt ${id}`,
  answer: 'réponse',
  ...extra
});

/** The base package at a new curriculum version with a second fr-a1-001 version. */
function update(
  curriculumVersion: string,
  questions: ContentQuestion[]
): ContentPackage {
  const pkg = approvedPackage();
  pkg.curriculumVersion = curriculumVersion;
  pkg.versions = [
    {
      id: 'fr-a1-001@2',
      skillId: 'fr-a1-001',
      version: 2,
      review: 'approved',
      questions
    }
  ];
  return pkg;
}

const same = (id: string, continues: string) =>
  question(id, { change: 'same', continues });

async function storedState() {
  const results = await client.batch(
    [
      'SELECT id, lineage_key FROM questions ORDER BY id',
      'SELECT kind, skill_id, question_id, previous_question_id FROM content_changes ORDER BY kind, question_id, previous_question_id, skill_id',
      'SELECT curriculum_version FROM curriculum_imports ORDER BY curriculum_version',
      'SELECT id, retired_at, replaced_by, carry_progress FROM skills ORDER BY id'
    ],
    'read'
  );
  return results.map((result) => result.rows.map((row) => ({ ...row })));
}

async function rejects(pkg: ContentPackage, code: string, detail?: RegExp) {
  const before = await storedState();
  const error = await importContent(client, pkg).catch((thrown) => thrown);
  expect(error).toBeInstanceOf(ContentImportError);
  expect((error as ContentImportError).code).toBe(code);
  if (detail) expect((error as ContentImportError).detail).toMatch(detail);
  expect(await storedState()).toEqual(before);
}

describe('declaring a change to an existing skill', () => {
  it('requires every question of a later version to declare its change', async () => {
    await rejects(
      update('0.2.0', [question('fr-a1-001@2:q1')]),
      'MISSING_CHANGE',
      /fr-a1-001@2:q1/u
    );
  });

  it('refuses a same question that continues nothing, or a continues on a new one', async () => {
    await rejects(
      update('0.2.0', [question('fr-a1-001@2:q1', { change: 'same' })]),
      'INVALID_CHANGE'
    );
    await rejects(
      update('0.2.0', [
        question('fr-a1-001@2:q1', {
          change: 'new',
          continues: 'fr-a1-001@1:q1'
        })
      ]),
      'INVALID_CHANGE'
    );
  });

  it('refuses a continues outside the earlier version, or one continued twice', async () => {
    await rejects(
      update('0.2.0', [same('fr-a1-001@2:q1', 'fr-a1-002@1:q1')]),
      'INVALID_CONTINUES'
    );
    await rejects(
      update('0.2.0', [
        same('fr-a1-001@2:q1', 'fr-a1-001@1:q1'),
        same('fr-a1-001@2:q2', 'fr-a1-001@1:q1')
      ]),
      'INVALID_CONTINUES',
      /continued twice/u
    );
  });

  it('refuses declarations on a skill that has no earlier version', async () => {
    const pkg = approvedPackage();
    pkg.curriculumVersion = '0.2.0';
    pkg.versions = [
      {
        id: 'fr-a1-003@1',
        skillId: 'fr-a1-003',
        version: 1,
        review: 'approved',
        questions: [question('fr-a1-003@1:q1', { change: 'new' })]
      }
    ];
    await rejects(pkg, 'INVALID_CHANGE', /follows no earlier version/u);
  });

  it('gives a continued question its earlier key and every other question its own id', async () => {
    await importContent(
      client,
      update('0.2.0', [
        same('fr-a1-001@2:q1', 'fr-a1-001@1:q1'),
        question('fr-a1-001@2:q2', { change: 'changed' }),
        question('fr-a1-001@2:q3', { change: 'new' })
      ])
    );
    const rows = await client.execute(
      "SELECT id, lineage_key FROM questions WHERE id LIKE 'fr-a1-001@%' ORDER BY id"
    );
    expect(rows.rows.map((row) => ({ ...row }))).toEqual([
      { id: 'fr-a1-001@1:q1', lineage_key: null },
      { id: 'fr-a1-001@1:q2', lineage_key: null },
      { id: 'fr-a1-001@2:q1', lineage_key: 'q1' },
      { id: 'fr-a1-001@2:q2', lineage_key: 'fr-a1-001@2:q2' },
      { id: 'fr-a1-001@2:q3', lineage_key: 'fr-a1-001@2:q3' }
    ]);
  });

  it('keeps a continued key across a third version', async () => {
    await importContent(
      client,
      update('0.1.1', [
        same('fr-a1-001@2:q1', 'fr-a1-001@1:q1'),
        same('fr-a1-001@2:q2', 'fr-a1-001@1:q2')
      ])
    );
    const third = update('0.1.2', [
      same('fr-a1-001@3:q1', 'fr-a1-001@2:q1'),
      same('fr-a1-001@3:q2', 'fr-a1-001@2:q2')
    ]);
    third.versions[0].id = 'fr-a1-001@3';
    third.versions[0].version = 3;
    await importContent(client, third);
    const key = await client.execute(
      "SELECT lineage_key FROM questions WHERE id = 'fr-a1-001@3:q1'"
    );
    expect(key.rows[0].lineage_key).toBe('q1');
  });

  it('logs what changed, including a removed question', async () => {
    await importContent(
      client,
      update('0.2.0', [
        same('fr-a1-001@2:q1', 'fr-a1-001@1:q1'),
        question('fr-a1-001@2:q3', { change: 'new' })
      ])
    );
    const log = await client.execute(
      "SELECT kind, question_id, previous_question_id FROM content_changes WHERE curriculum_version = '0.2.0' ORDER BY kind, question_id"
    );
    expect(log.rows.map((row) => ({ ...row }))).toEqual([
      {
        kind: 'question-new',
        question_id: 'fr-a1-001@2:q3',
        previous_question_id: null
      },
      {
        kind: 'question-removed',
        question_id: null,
        previous_question_id: 'fr-a1-001@1:q2'
      },
      {
        kind: 'question-same',
        question_id: 'fr-a1-001@2:q1',
        previous_question_id: 'fr-a1-001@1:q1'
      },
      { kind: 'version-added', question_id: null, previous_question_id: null }
    ]);
  });

  it('refuses a version lower than one already stored for the skill', async () => {
    const third = update('0.2.0', [same('fr-a1-001@3:q1', 'fr-a1-001@1:q1')]);
    third.versions[0].id = 'fr-a1-001@3';
    third.versions[0].version = 3;
    await importContent(client, third);
    const lower = update('0.3.0', [
      question('fr-a1-001@2:q9', { change: 'new' })
    ]);
    await rejects(lower, 'VERSION_ORDER');
    await expect(contentImpact(client, lower)).rejects.toMatchObject({
      code: 'VERSION_ORDER'
    });
  });

  it('records the first import as skills and versions added', async () => {
    const log = await client.execute(
      "SELECT kind, count(*) AS n FROM content_changes WHERE curriculum_version = '0.1.0' GROUP BY kind ORDER BY kind"
    );
    expect(log.rows.map((row) => ({ ...row }))).toEqual([
      { kind: 'skill-added', n: 3 },
      { kind: 'version-added', n: 2 }
    ]);
  });

  it('makes the declaration part of the immutable version', async () => {
    await importContent(
      client,
      update('0.2.0', [question('fr-a1-001@2:q1', { change: 'new' })])
    );
    await rejects(
      update('0.3.0', [question('fr-a1-001@2:q1', { change: 'changed' })]),
      'CONTENT_CONFLICT'
    );
  });
});

describe('the curriculum version bump', () => {
  const wording = () => [
    same('fr-a1-001@2:q1', 'fr-a1-001@1:q1'),
    same('fr-a1-001@2:q2', 'fr-a1-001@1:q2')
  ];

  it('accepts a patch bump for wording-only changes', async () => {
    await importContent(client, update('0.1.1', wording()));
    const versions = await client.execute(
      'SELECT curriculum_version FROM curriculum_imports ORDER BY curriculum_version'
    );
    expect(versions.rows.map((row) => row.curriculum_version)).toEqual([
      '0.1.0',
      '0.1.1'
    ]);
  });

  it('refuses a larger bump than wording-only changes need', async () => {
    await rejects(
      update('0.2.0', wording()),
      'VERSION_BUMP',
      /minor bump.*need a patch bump/u
    );
  });

  it('refuses a patch bump for changed content', async () => {
    await rejects(
      update('0.1.1', [question('fr-a1-001@2:q1', { change: 'changed' })]),
      'VERSION_BUMP',
      /patch bump.*need a minor bump/u
    );
  });

  it('refuses a patch bump when a question is dropped', async () => {
    await rejects(
      update('0.1.1', [same('fr-a1-001@2:q1', 'fr-a1-001@1:q1')]),
      'VERSION_BUMP'
    );
  });

  it('refuses a major bump for changed content', async () => {
    await rejects(
      update('1.0.0', [question('fr-a1-001@2:q1', { change: 'new' })]),
      'VERSION_BUMP',
      /major bump.*need a minor bump/u
    );
  });

  it('lets a package with no row changes take any newer version', async () => {
    const reissued = approvedPackage();
    reissued.curriculumVersion = '3.0.0';
    await importContent(client, reissued);
    expect((await storedState())[2]).toEqual([
      { curriculum_version: '0.1.0' },
      { curriculum_version: '3.0.0' }
    ]);
  });

  it('takes a patch bump for a quarantine, and logs which version was withdrawn', async () => {
    const pkg = approvedPackage();
    pkg.curriculumVersion = '0.1.1';
    pkg.versions[0].review = 'quarantined';
    await importContent(client, pkg);
    const log = await client.execute(
      "SELECT skill_id, content_version_id FROM content_changes WHERE kind = 'version-quarantined'"
    );
    expect(log.rows.map((row) => ({ ...row }))).toEqual([
      { skill_id: 'fr-a1-001', content_version_id: 'fr-a1-001@1' }
    ]);
  });

  it('needs a minor bump for a new skill', async () => {
    const pkg = approvedPackage();
    pkg.curriculumVersion = '0.1.1';
    pkg.skills.push({
      id: 'fr-a1-004',
      language: 'fr',
      level: 'A1',
      review: 'approved',
      prerequisites: []
    });
    await rejects(pkg, 'VERSION_BUMP', /need a minor bump/u);
  });
});

describe('retiring a skill', () => {
  const retire = (
    version: string,
    retirement: NonNullable<ContentPackage['retirements']>[number]
  ) => {
    const pkg = approvedPackage();
    pkg.curriculumVersion = version;
    pkg.skills = pkg.skills.filter((skill) => skill.id !== retirement.skillId);
    pkg.versions = pkg.versions.filter(
      (version) => version.skillId !== retirement.skillId
    );
    pkg.retirements = [retirement];
    return pkg;
  };

  it('marks the skill retired with its replacement and logs it, needing a major bump', async () => {
    const pkg = retire('1.0.0', {
      skillId: 'fr-a1-002',
      replacedBy: 'fr-a1-003',
      carry: true
    });
    pkg.skills = pkg.skills.map((skill) => ({
      ...skill,
      prerequisites: skill.prerequisites.filter((id) => id !== 'fr-a1-002')
    }));
    await importContent(client, pkg);
    const skill = await client.execute(
      "SELECT retired_at, replaced_by, carry_progress FROM skills WHERE id = 'fr-a1-002'"
    );
    expect(skill.rows[0].retired_at).toEqual(expect.any(Number));
    expect(skill.rows[0].replaced_by).toBe('fr-a1-003');
    expect(skill.rows[0].carry_progress).toBe(1);
    const log = await client.execute(
      "SELECT skill_id FROM content_changes WHERE kind = 'skill-retired'"
    );
    expect(log.rows.map((row) => row.skill_id)).toEqual(['fr-a1-002']);
  });

  it('refuses a retirement under a bump smaller than major', async () => {
    await rejects(
      retire('0.2.0', { skillId: 'fr-a1-002' }),
      'VERSION_BUMP',
      /need a major bump/u
    );
  });

  it('is a no-op when the same package is imported again', async () => {
    const pkg = retire('1.0.0', { skillId: 'fr-a1-002' });
    await importContent(client, pkg);
    const before = await storedState();
    await importContent(client, retire('1.0.0', { skillId: 'fr-a1-002' }));
    expect(await storedState()).toEqual(before);
  });

  it('refuses unknown skills, a replacement in another language, and carry without a replacement', async () => {
    await rejects(
      retire('1.0.0', { skillId: 'fr-a1-099' }),
      'MISSING_REFERENCE'
    );
    await rejects(
      retire('1.0.0', { skillId: 'fr-a1-002', replacedBy: 'fr-a1-099' }),
      'MISSING_REFERENCE'
    );
    await rejects(
      retire('1.0.0', { skillId: 'fr-a1-002', carry: true }),
      'INVALID_RETIREMENT'
    );
  });

  it('refuses a replacement in another language', async () => {
    const pkg = retire('1.0.0', {
      skillId: 'fr-a1-002',
      replacedBy: 'en-a1-001'
    });
    pkg.skills.push({
      id: 'en-a1-001',
      language: 'en',
      level: 'A1',
      review: 'approved',
      prerequisites: []
    });
    await rejects(pkg, 'INVALID_RETIREMENT', /changes language/u);
  });

  it('refuses a skill that is retired and still in the package', async () => {
    const pkg = approvedPackage();
    pkg.curriculumVersion = '1.0.0';
    pkg.retirements = [{ skillId: 'fr-a1-002' }];
    await rejects(pkg, 'INVALID_RETIREMENT');
  });

  it('refuses carrying progress into a skill that is retired, so carries cannot loop', async () => {
    const both = approvedPackage();
    both.curriculumVersion = '1.0.0';
    both.skills = both.skills
      .filter((skill) => !['fr-a1-002', 'fr-a1-003'].includes(skill.id))
      .map((skill) => ({ ...skill, prerequisites: [] }));
    both.versions = both.versions.filter(
      (version) => !['fr-a1-002', 'fr-a1-003'].includes(version.skillId)
    );
    both.retirements = [
      { skillId: 'fr-a1-002', replacedBy: 'fr-a1-003', carry: true },
      { skillId: 'fr-a1-003', replacedBy: 'fr-a1-002', carry: true }
    ];
    await rejects(both, 'INVALID_RETIREMENT', /cannot receive carried/u);

    const first = retire('1.0.0', {
      skillId: 'fr-a1-002',
      replacedBy: 'fr-a1-003',
      carry: true
    });
    first.skills = first.skills.map((skill) => ({
      ...skill,
      prerequisites: skill.prerequisites.filter((id) => id !== 'fr-a1-002')
    }));
    await importContent(client, first);
    const back = retire('2.0.0', {
      skillId: 'fr-a1-003',
      replacedBy: 'fr-a1-002',
      carry: true
    });
    back.skills = approvedPackage().skills.filter(
      (skill) => skill.id !== 'fr-a1-003'
    );
    await rejects(back, 'INVALID_RETIREMENT', /cannot receive carried/u);
  });

  it('treats a historical carried retirement as a no-op after its replacement is retired', async () => {
    const strip = (pkg: ContentPackage, gone: string[]) => {
      pkg.skills = pkg.skills.map((skill) => ({
        ...skill,
        prerequisites: skill.prerequisites.filter((id) => !gone.includes(id))
      }));
      return pkg;
    };
    const first = strip(
      retire('1.0.0', {
        skillId: 'fr-a1-002',
        replacedBy: 'fr-a1-003',
        carry: true
      }),
      ['fr-a1-002']
    );
    await importContent(client, first);
    const later = strip(retire('2.0.0', { skillId: 'fr-a1-003' }), [
      'fr-a1-002',
      'fr-a1-003'
    ]);
    later.skills = later.skills.filter((skill) => skill.id !== 'fr-a1-002');
    later.versions = later.versions.filter(
      (version) => version.skillId !== 'fr-a1-002'
    );
    await importContent(client, later);
    const before = await storedState();
    await importContent(client, first);
    expect(await storedState()).toEqual(before);
  });

  it('refuses to change an earlier retirement', async () => {
    await importContent(client, retire('1.0.0', { skillId: 'fr-a1-002' }));
    await rejects(
      retire('2.0.0', { skillId: 'fr-a1-002', replacedBy: 'fr-a1-003' }),
      'CONTENT_CONFLICT'
    );
  });
});

describe('the impact report', () => {
  const answer = (questionId: string, key: string, value = 'réponse') =>
    recordAttempt(client, testSession('learner-a'), {
      studySessionId: 'study-a',
      questionId,
      submissionKey: key,
      evidenceKind: 'independent',
      answer: value
    });

  it('counts the independent answers that would stop counting, and writes nothing', async () => {
    await answer('fr-a1-001@1:q1', 'one');
    await answer('fr-a1-001@1:q2', 'two', 'es');
    const pkg = update('0.2.0', [
      same('fr-a1-001@2:q1', 'fr-a1-001@1:q1'),
      question('fr-a1-001@2:q3', { change: 'new' })
    ]);
    const before = await storedState();
    expect(await contentImpact(client, pkg)).toEqual([
      {
        skillId: 'fr-a1-001',
        reason: '1 question(s) changed or removed in fr-a1-001@2',
        answers: 1,
        learners: 1
      }
    ]);
    expect(await storedState()).toEqual(before);
  });

  it('leaves out answers that mastery does not count, such as Not sure', async () => {
    await answer('fr-a1-001@1:q1', 'one');
    await recordAttempt(client, testSession('learner-a'), {
      studySessionId: 'study-a',
      questionId: 'fr-a1-001@1:q2',
      submissionKey: 'unsure',
      evidenceKind: 'independent',
      answer: '',
      notSure: true
    });
    const pkg = update('0.2.0', [
      question('fr-a1-001@2:q3', { change: 'new' })
    ]);
    expect(await contentImpact(client, pkg)).toMatchObject([
      { skillId: 'fr-a1-001', answers: 1, learners: 1 }
    ]);
  });

  it('reports the answers lost when a stored current version is quarantined', async () => {
    const pkg = update('0.2.0', [
      same('fr-a1-001@2:q1', 'fr-a1-001@1:q1'),
      question('fr-a1-001@2:q3', { change: 'new' })
    ]);
    await importContent(client, pkg);
    await client.execute(
      "INSERT INTO study_sessions (id, owner_id, enrollment_id, language, mode) VALUES ('study-two', 'learner-a', 'enrollment-a', 'fr', 'practice')"
    );
    await recordAttempt(client, testSession('learner-a'), {
      studySessionId: 'study-two',
      questionId: 'fr-a1-001@2:q3',
      submissionKey: 'three',
      evidenceKind: 'independent',
      answer: 'réponse'
    });
    const withdrawn = structuredClone(pkg);
    withdrawn.versions[0].review = 'quarantined';
    expect(await contentImpact(client, withdrawn)).toMatchObject([
      { skillId: 'fr-a1-001', answers: 1, learners: 1 }
    ]);
  });

  it('reports nothing for a new version the package quarantines on arrival', async () => {
    await answer('fr-a1-001@1:q2', 'two', 'es');
    const pkg = update('0.2.1', [
      question('fr-a1-001@2:q3', { change: 'new' })
    ]);
    pkg.versions[0].review = 'quarantined';
    expect(await contentImpact(client, pkg)).toEqual([]);
  });

  it('counts an answer lost to quarantine although the fallback version shares its key', async () => {
    await importContent(
      client,
      update('0.1.1', [
        same('fr-a1-001@2:q1', 'fr-a1-001@1:q1'),
        same('fr-a1-001@2:q2', 'fr-a1-001@1:q2')
      ])
    );
    await client.execute(
      "INSERT INTO study_sessions (id, owner_id, enrollment_id, language, mode) VALUES ('study-two', 'learner-a', 'enrollment-a', 'fr', 'practice')"
    );
    await recordAttempt(client, testSession('learner-a'), {
      studySessionId: 'study-two',
      questionId: 'fr-a1-001@2:q2',
      submissionKey: 'shared',
      evidenceKind: 'independent',
      answer: 'réponse'
    });
    const withdrawn = update('0.1.2', [
      same('fr-a1-001@2:q1', 'fr-a1-001@1:q1'),
      same('fr-a1-001@2:q2', 'fr-a1-001@1:q2')
    ]);
    withdrawn.versions[0].review = 'quarantined';
    expect(await contentImpact(client, withdrawn)).toMatchObject([
      { skillId: 'fr-a1-001', answers: 1, learners: 1 }
    ]);
  });

  it('ignores answers to items the skill no longer holds when an older version is quarantined', async () => {
    await answer('fr-a1-001@1:q2', 'two', 'es');
    await importContent(
      client,
      update('0.2.0', [
        same('fr-a1-001@2:q1', 'fr-a1-001@1:q1'),
        question('fr-a1-001@2:q2', { change: 'changed' })
      ])
    );
    const withdrawn = approvedPackage();
    withdrawn.curriculumVersion = '0.2.1';
    withdrawn.versions[0].review = 'quarantined';
    expect(await contentImpact(client, withdrawn)).toMatchObject([
      { skillId: 'fr-a1-001', answers: 0, learners: 0 }
    ]);
  });

  it('plans a version against a quarantined one before it in the same package', async () => {
    await answer('fr-a1-001@1:q2', 'two', 'es');
    const pkg = update('0.2.0', [
      same('fr-a1-001@2:q1', 'fr-a1-001@1:q1'),
      same('fr-a1-001@2:q2', 'fr-a1-001@1:q2')
    ]);
    pkg.versions.push(
      {
        id: 'fr-a1-001@3',
        skillId: 'fr-a1-001',
        version: 3,
        review: 'quarantined',
        questions: [
          same('fr-a1-001@3:q1', 'fr-a1-001@2:q1'),
          question('fr-a1-001@3:q2', { change: 'changed' })
        ]
      },
      {
        id: 'fr-a1-001@4',
        skillId: 'fr-a1-001',
        version: 4,
        review: 'approved',
        questions: [
          same('fr-a1-001@4:q1', 'fr-a1-001@3:q1'),
          same('fr-a1-001@4:q2', 'fr-a1-001@3:q2')
        ]
      }
    );
    // v4 is current, and its q2 descends from the changed v3 q2, so the
    // answer to the original q2 stops counting.
    expect(await contentImpact(client, pkg)).toMatchObject([
      { skillId: 'fr-a1-001', answers: 1, learners: 1 }
    ]);
  });

  it('plans successive new versions of a skill against each other', async () => {
    const pkg = update('0.2.0', [
      same('fr-a1-001@2:q1', 'fr-a1-001@1:q1'),
      same('fr-a1-001@2:q2', 'fr-a1-001@1:q2')
    ]);
    pkg.versions.push({
      id: 'fr-a1-001@3',
      skillId: 'fr-a1-001',
      version: 3,
      review: 'approved',
      questions: [same('fr-a1-001@3:q1', 'fr-a1-001@2:q1')]
    });
    await answer('fr-a1-001@1:q2', 'two', 'es');
    expect(await contentImpact(client, pkg)).toMatchObject([
      {
        skillId: 'fr-a1-001',
        reason: '1 question(s) changed or removed in fr-a1-001@3',
        answers: 1,
        learners: 1
      }
    ]);
  });

  it('reports nothing for wording-only changes, and refuses an undeclared version', async () => {
    await answer('fr-a1-001@1:q1', 'one');
    expect(
      await contentImpact(
        client,
        update('0.1.1', [
          same('fr-a1-001@2:q1', 'fr-a1-001@1:q1'),
          same('fr-a1-001@2:q2', 'fr-a1-001@1:q2')
        ])
      )
    ).toEqual([]);
    await expect(
      contentImpact(client, update('0.2.0', [question('fr-a1-001@2:q1')]))
    ).rejects.toMatchObject({ code: 'MISSING_CHANGE' });
  });

  it('counts a retired skill that does not carry over, and only the unmatched items of one that does', async () => {
    await answer('fr-a1-002@1:q1', 'three', 'On est ici.');
    const retire = (carry: boolean) => {
      const pkg = approvedPackage();
      pkg.curriculumVersion = '1.0.0';
      pkg.skills = pkg.skills.filter((skill) => skill.id !== 'fr-a1-002');
      pkg.versions = pkg.versions.filter((v) => v.skillId !== 'fr-a1-002');
      pkg.retirements = [
        { skillId: 'fr-a1-002', replacedBy: 'fr-a1-003', carry }
      ];
      return pkg;
    };
    expect(await contentImpact(client, retire(false))).toMatchObject([
      { skillId: 'fr-a1-002', answers: 1, learners: 1 }
    ]);
    // fr-a1-003 has no content yet, so nothing it could count matches.
    expect(await contentImpact(client, retire(true))).toMatchObject([
      { skillId: 'fr-a1-002', answers: 1, learners: 1 }
    ]);
    const twin = approvedPackage();
    twin.curriculumVersion = '0.2.0';
    twin.versions.push({
      id: 'fr-a1-003@1',
      skillId: 'fr-a1-003',
      version: 1,
      review: 'approved',
      questions: [question('fr-a1-003@1:q1')]
    });
    await importContent(client, twin);
    // fr-a1-003 now holds an item with the same key, so the answer carries.
    expect(await contentImpact(client, retire(true))).toMatchObject([
      { skillId: 'fr-a1-002', answers: 0, learners: 0 }
    ]);
  });

  it('plans a carry against a replacement the same package adds', async () => {
    await answer('fr-a1-002@1:q1', 'three', 'On est ici.');
    const pkg = approvedPackage();
    pkg.curriculumVersion = '1.0.0';
    pkg.skills = pkg.skills.filter((skill) => skill.id !== 'fr-a1-002');
    pkg.versions = pkg.versions.filter((v) => v.skillId !== 'fr-a1-002');
    pkg.versions.push({
      id: 'fr-a1-003@1',
      skillId: 'fr-a1-003',
      version: 1,
      review: 'approved',
      questions: [question('fr-a1-003@1:q1')]
    });
    pkg.retirements = [
      { skillId: 'fr-a1-002', replacedBy: 'fr-a1-003', carry: true }
    ];
    expect(await contentImpact(client, pkg)).toMatchObject([
      { skillId: 'fr-a1-002', answers: 0, learners: 0 }
    ]);
  });

  it('keeps a carry target plan across a newer version the package quarantines', async () => {
    await answer('fr-a1-002@1:q1', 'three', 'On est ici.');
    const pkg = approvedPackage();
    pkg.curriculumVersion = '1.0.0';
    pkg.versions.push(
      {
        id: 'fr-a1-003@1',
        skillId: 'fr-a1-003',
        version: 1,
        review: 'approved',
        questions: [question('fr-a1-003@1:q1')]
      },
      {
        id: 'fr-a1-003@2',
        skillId: 'fr-a1-003',
        version: 2,
        review: 'quarantined',
        questions: [question('fr-a1-003@2:q9', { change: 'new' })]
      }
    );
    pkg.retirements = [
      { skillId: 'fr-a1-002', replacedBy: 'fr-a1-003', carry: true }
    ];
    expect(await contentImpact(client, pkg)).toMatchObject([
      { skillId: 'fr-a1-002', answers: 0, learners: 0 }
    ]);
  });

  it('counts answers carried into a skill when that skill is retired without carry', async () => {
    await answer('fr-a1-002@1:q1', 'three', 'On est ici.');
    const twin = approvedPackage();
    twin.curriculumVersion = '0.2.0';
    twin.versions.push({
      id: 'fr-a1-003@1',
      skillId: 'fr-a1-003',
      version: 1,
      review: 'approved',
      questions: [question('fr-a1-003@1:q1')]
    });
    await importContent(client, twin);
    await client.execute(
      "UPDATE skills SET retired_at = 1, replaced_by = 'fr-a1-003', carry_progress = 1 WHERE id = 'fr-a1-002'"
    );
    const pkg = approvedPackage();
    pkg.retirements = [{ skillId: 'fr-a1-003' }];
    expect(await contentImpact(client, pkg)).toMatchObject([
      { skillId: 'fr-a1-003', answers: 1, learners: 1 }
    ]);
  });
});
