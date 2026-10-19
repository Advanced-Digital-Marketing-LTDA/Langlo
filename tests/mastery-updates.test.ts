import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { getMastery } from '../src/lib/server/mastery';
import {
  importContent,
  type ContentPackage,
  type ContentQuestion
} from '../src/lib/server/content-import';
import { recordAttempt } from '../src/lib/server/study';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession
} from './fixtures/flashcards';
import { approvedPackage } from './fixtures/content-package';

// LANGLO-168: which stored answers count toward mastery after content is
// updated. Answers are never rewritten; the policy decides what counts.

const learner = testSession('learner-a');
let client: Client;
let close: () => void;
let sessions = 0;

beforeEach(async () => {
  ({ client, close } = await openFixtureDatabase(await fixture()));
  await importContent(client, approvedPackage());
});
afterEach(async () => {
  close?.();
  await disposeFlashcardFixtures();
});

/** A fresh practice session, so each content version pins its own. */
async function newSession() {
  sessions += 1;
  const id = `update-session-${sessions}`;
  await client.execute({
    sql: "INSERT INTO study_sessions (id, owner_id, enrollment_id, language, mode) VALUES (?, 'learner-a', 'enrollment-a', 'fr', 'practice')",
    args: [id]
  });
  return id;
}

async function answer(questionId: string, value: string, session?: string) {
  return recordAttempt(client, learner, {
    studySessionId: session ?? (await newSession()),
    questionId,
    submissionKey: `${questionId}-${value}-${sessions}`,
    evidenceKind: 'independent',
    answer: value
  });
}

const skill = async (id: string) =>
  (await getMastery(client, learner, 'fr')).find((item) => item.skillId === id);

const question = (
  id: string,
  extra: Partial<ContentQuestion> = {}
): ContentQuestion => ({
  id,
  format: 'typed-blank',
  prompt: `Prompt ${id}`,
  answer: 'es',
  ...extra
});

function secondVersion(
  curriculumVersion: string,
  questions: ContentQuestion[],
  review = 'approved'
): ContentPackage {
  const pkg = approvedPackage();
  pkg.curriculumVersion = curriculumVersion;
  pkg.versions = [
    {
      id: 'fr-a1-001@2',
      skillId: 'fr-a1-001',
      version: 2,
      review,
      questions
    }
  ];
  return pkg;
}

const same = (id: string, continues: string) =>
  question(id, { change: 'same', continues });

describe('mastery after a content update', () => {
  it('keeps counting an answer to a question that kept its meaning, once', async () => {
    await answer('fr-a1-001@1:q2', 'es');
    await importContent(
      client,
      secondVersion('0.1.1', [
        same('fr-a1-001@2:q1', 'fr-a1-001@1:q1'),
        same('fr-a1-001@2:q2', 'fr-a1-001@1:q2')
      ])
    );
    expect(await skill('fr-a1-001')).toMatchObject({
      correct: 1,
      incorrect: 0,
      independentItems: 1
    });
    await answer('fr-a1-001@2:q2', 'wrong');
    expect(await skill('fr-a1-001')).toMatchObject({
      correct: 1,
      incorrect: 0,
      independentItems: 1
    });
  });

  it('stops counting an answer to a changed question that kept its number, and counts the new answer', async () => {
    await answer('fr-a1-001@1:q2', 'wrong');
    await importContent(
      client,
      secondVersion('0.2.0', [
        same('fr-a1-001@2:q1', 'fr-a1-001@1:q1'),
        question('fr-a1-001@2:q2', { change: 'changed' })
      ])
    );
    expect(await skill('fr-a1-001')).toMatchObject({
      contentVersionId: 'fr-a1-001@2',
      independentItems: 0,
      status: 'unknown'
    });
    await answer('fr-a1-001@2:q2', 'es');
    expect(await skill('fr-a1-001')).toMatchObject({
      correct: 1,
      incorrect: 0,
      independentItems: 1
    });
  });

  it('stops counting an answer to a question the update removed', async () => {
    await answer('fr-a1-001@1:q2', 'es');
    await importContent(
      client,
      secondVersion('0.2.0', [same('fr-a1-001@2:q1', 'fr-a1-001@1:q1')])
    );
    expect(await skill('fr-a1-001')).toMatchObject({ independentItems: 0 });
  });

  it('never deletes or rewrites what the learner answered', async () => {
    await answer('fr-a1-001@1:q2', 'wrong');
    await getMastery(client, learner, 'fr');
    const read = async () =>
      (
        await client.batch(
          [
            'SELECT * FROM attempts ORDER BY id',
            'SELECT * FROM evaluations ORDER BY id',
            'SELECT * FROM skill_evidence ORDER BY id'
          ],
          'read'
        )
      ).map((result) => result.rows.map((row) => ({ ...row })));
    const before = await read();
    await importContent(
      client,
      secondVersion('0.2.0', [question('fr-a1-001@2:q2', { change: 'new' })])
    );
    await getMastery(client, learner, 'fr');
    expect(await read()).toEqual(before);
  });

  it('counts the earlier version again when the newest one is quarantined', async () => {
    await answer('fr-a1-001@1:q2', 'es');
    await importContent(
      client,
      secondVersion('0.2.0', [question('fr-a1-001@2:q2', { change: 'new' })])
    );
    expect(await skill('fr-a1-001')).toMatchObject({ independentItems: 0 });
    await importContent(
      client,
      secondVersion(
        '0.2.1',
        [question('fr-a1-001@2:q2', { change: 'new' })],
        'quarantined'
      )
    );
    expect(await skill('fr-a1-001')).toMatchObject({
      independentItems: 1,
      available: false
    });
  });
});

describe('mastery for a retired skill', () => {
  /** fr-a1-003 becomes the home of fr-a1-002, which leaves the catalog. */
  function renamed(carry: boolean): ContentPackage {
    const pkg = approvedPackage();
    pkg.curriculumVersion = '1.0.0';
    pkg.skills = pkg.skills.filter((item) => item.id !== 'fr-a1-002');
    pkg.versions = [
      {
        id: 'fr-a1-003@1',
        skillId: 'fr-a1-003',
        version: 1,
        review: 'approved',
        questions: [
          {
            id: 'fr-a1-003@1:q1',
            format: 'translation',
            prompt: 'We are here.',
            answer: 'Nous sommes ici.',
            alternatives: ['On est ici.']
          }
        ]
      }
    ];
    pkg.retirements = [
      { skillId: 'fr-a1-002', replacedBy: 'fr-a1-003', carry }
    ];
    return pkg;
  }

  it('leaves the catalog and keeps its history stored', async () => {
    await answer('fr-a1-002@1:q1', 'Nous sommes ici.');
    await importContent(client, renamed(false));
    const catalog = await getMastery(client, learner, 'fr');
    expect(catalog.map((item) => item.skillId)).not.toContain('fr-a1-002');
    expect(await skill('fr-a1-003')).toMatchObject({ independentItems: 0 });
    expect(
      (
        await client.execute('SELECT 1 FROM attempts WHERE skill_id = ?', [
          'fr-a1-002'
        ])
      ).rows
    ).toHaveLength(1);
  });

  it('stops listing the retired skill as a prerequisite', async () => {
    expect((await skill('fr-a1-003'))?.prerequisites).toContain('fr-a1-002');
    await importContent(client, renamed(false));
    expect((await skill('fr-a1-003'))?.prerequisites).toEqual(['fr-a1-001']);
  });

  it('counts the answers for the replacement when the owner approved a carry', async () => {
    await answer('fr-a1-002@1:q1', 'Nous sommes ici.');
    await importContent(client, renamed(true));
    expect(await skill('fr-a1-003')).toMatchObject({
      correct: 1,
      incorrect: 0,
      independentItems: 1
    });
    await answer('fr-a1-003@1:q1', 'wrong');
    expect(await skill('fr-a1-003')).toMatchObject({
      correct: 1,
      incorrect: 0,
      independentItems: 1
    });
  });
});
