import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import {
  enroll,
  EXPLANATION_LANGUAGES,
  levelsFor,
  listEnrollments,
  setExplanationLanguage,
  TRACK_LANGUAGES
} from '../src/lib/server/enrollment';
import {
  assessmentResults,
  getAssessment,
  startAssessment
} from '../src/lib/server/assessment';
import { recordAttempt } from '../src/lib/server/study';
import { assessmentLevels, foundationLevel } from '../src/lib/levels';
import { load as enrollLoad } from '../src/routes/app/enroll/+page.server';
import { load as settingsLoad } from '../src/routes/app/settings/+page.server';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession
} from './fixtures/flashcards';

// Portuguese (Brazil) B1/B2 in enrollment, settings and placement assessment.
// The synthetic content here exercises the platform, not the curriculum.

const learner = testSession('pt-learner');
let client: Client;
let close: () => void;
let databaseUrl: string;

beforeEach(async () => {
  const target = await fixture();
  databaseUrl = target.databaseUrl;
  ({ client, close } = await openFixtureDatabase(target));
  await client.execute("INSERT INTO users (id) VALUES ('pt-learner')");
});

afterEach(async () => {
  close?.();
  await disposeFlashcardFixtures();
});

const fields = {
  language: 'pt',
  startingLevel: 'B1',
  explanationLanguage: 'en'
};

function event(userId = 'pt-learner') {
  return {
    params: {},
    url: new URL('http://127.0.0.1/app'),
    locals: {
      user: { id: userId },
      session: { userId },
      config: { dataEnabled: true, databaseUrl }
    },
    request: new Request('http://127.0.0.1/app')
  } as never;
}

describe('track and level rules', () => {
  it('offers Portuguese at B1 and B2 and leaves the other tracks as they were', () => {
    expect(TRACK_LANGUAGES).toEqual(['fr', 'de', 'en', 'pt']);
    expect(levelsFor('pt')).toEqual(['B1', 'B2']);
    expect(levelsFor('fr')).toEqual(['A1']);
    expect(levelsFor('de')).toEqual(['A1', 'A2']);
    expect(levelsFor('en')).toEqual(['A1', 'A2']);
  });

  it('reports a placement assessment over B1 and B2 for Portuguese and A1 and A2 for the rest', () => {
    expect(assessmentLevels('pt')).toEqual(['B1', 'B2']);
    for (const language of ['fr', 'de', 'en'])
      expect(assessmentLevels(language)).toEqual(['A1', 'A2']);
    expect(foundationLevel('pt')).toBe('B1');
    expect(foundationLevel('fr')).toBe('A1');
  });
});

describe('Portuguese enrollment', () => {
  it.each(['B1', 'B2'])('enrolls at %s with English lessons', async (level) => {
    await enroll(client, learner, { ...fields, startingLevel: level });
    expect(await listEnrollments(client, learner)).toEqual([
      { language: 'pt', startingLevel: level, explanationLanguage: 'en' }
    ]);
  });

  it.each([
    { startingLevel: 'A1' },
    { startingLevel: 'A2' },
    { explanationLanguage: 'pt' },
    { language: 'fr', startingLevel: 'B1' },
    { language: 'de', startingLevel: 'B2' },
    { language: 'en', startingLevel: 'B1' }
  ])('refuses %j and stores nothing', async (bad) => {
    await expect(
      enroll(client, learner, { ...fields, ...bad })
    ).rejects.toMatchObject({ code: 'INVALID_ENROLLMENT' });
    expect(await listEnrollments(client, learner)).toEqual([]);
  });

  it('keeps Portuguese lessons in English when the lesson language is changed', async () => {
    await enroll(client, learner, fields);
    await expect(
      setExplanationLanguage(client, learner, {
        language: 'pt',
        explanationLanguage: 'pt'
      })
    ).rejects.toMatchObject({ code: 'INVALID_ENROLLMENT' });
    expect((await listEnrollments(client, learner))[0]).toMatchObject({
      explanationLanguage: 'en'
    });
  });

  it('still lets the other tracks pick either lesson language', async () => {
    await enroll(client, learner, {
      language: 'en',
      startingLevel: 'A1',
      explanationLanguage: 'pt'
    });
    await setExplanationLanguage(client, learner, {
      language: 'en',
      explanationLanguage: 'en'
    });
    expect((await listEnrollments(client, learner))[0]).toMatchObject({
      explanationLanguage: 'en'
    });
  });

  it('shows the enroll and settings pages only the lesson languages each track allows', async () => {
    await enroll(client, learner, fields);
    const enrollPage = await enrollLoad(event());
    expect(enrollPage).toMatchObject({
      languages: ['fr', 'de', 'en', 'pt'],
      levels: { pt: ['B1', 'B2'], fr: ['A1'] },
      explanationLanguagesByTrack: {
        pt: ['en'],
        fr: [...EXPLANATION_LANGUAGES],
        de: [...EXPLANATION_LANGUAGES],
        en: [...EXPLANATION_LANGUAGES]
      }
    });
    expect(await settingsLoad(event())).toMatchObject({
      explanationLanguagesByTrack: { pt: ['en'] }
    });
  });
});

describe('Portuguese placement assessment', () => {
  async function seedPortugueseAssessment() {
    await enroll(client, learner, fields);
    const skills = [
      { id: 'pt-b1-001', level: 'B1' },
      { id: 'pt-b1-002', level: 'B1' },
      { id: 'pt-b2-001', level: 'B2' }
    ];
    await client.batch(
      skills.flatMap(({ id, level }) => [
        {
          sql: 'INSERT INTO skills (id, language, level) VALUES (?, ?, ?)',
          args: [id, 'pt', level]
        },
        {
          sql: "INSERT INTO content_versions (id, skill_id, language, version, status) VALUES (?, ?, 'pt', 1, 'pilot-ready')",
          args: [`${id}@1`, id]
        },
        {
          sql: "INSERT INTO questions (id, content_version_id, skill_id, language, format, holdout, prompt, answer) VALUES (?, ?, ?, 'pt', 'typed-blank', 1, ?, 'fui')",
          args: [`${id}@1:h01`, `${id}@1`, id, `Eu ___ ontem. (${id})`]
        }
      ]),
      'write'
    );
    return startAssessment(client, learner, {
      language: 'pt',
      submissionKey: randomUUID()
    });
  }

  const answer = (id: string, questionId: string, value: string) =>
    recordAttempt(client, learner, {
      studySessionId: id,
      questionId,
      submissionKey: randomUUID(),
      evidenceKind: 'independent',
      answer: value
    });

  it('counts the plan by B1 and B2 and reports B1 gaps, not A1 gaps', async () => {
    const { id } = await seedPortugueseAssessment();
    expect(await getAssessment(client, learner, id)).toMatchObject({
      total: 3,
      coverage: { B1: 2, B2: 1 }
    });
    expect(
      (await getAssessment(client, learner, id)).coverage
    ).not.toHaveProperty('A1');
    await answer(id, 'pt-b1-001@1:h01', 'fui');
    await answer(id, 'pt-b1-002@1:h01', 'errado');
    await answer(id, 'pt-b2-001@1:h01', 'errado');
    expect(await assessmentResults(client, learner, id)).toMatchObject({
      // Without a configured fallback evaluator a wrong typed answer stays uncertain.
      counts: { correct: 1, incorrect: 0, uncertain: 2 },
      foundationLevel: 'B1',
      foundationGaps: ['pt-b1-002']
    });
  });

  it('keeps A1 and A2 coverage and gaps for the existing tracks', async () => {
    await client.execute(
      "INSERT INTO enrollments (id, owner_id, language, starting_level, explanation_language) VALUES ('e-fr', 'pt-learner', 'fr', 'A1', 'en')"
    );
    await client.execute(
      "UPDATE skills SET retired_at = 1 WHERE language = 'fr'"
    );
    await client.batch(
      [
        "INSERT INTO skills (id, language, level) VALUES ('fr-a1-001', 'fr', 'A1')",
        "INSERT INTO content_versions (id, skill_id, language, version, status) VALUES ('fr-a1-001@1', 'fr-a1-001', 'fr', 1, 'pilot-ready')",
        "INSERT INTO questions (id, content_version_id, skill_id, language, format, holdout, prompt, answer) VALUES ('fr-a1-001@1:h01', 'fr-a1-001@1', 'fr-a1-001', 'fr', 'typed-blank', 1, 'Je ___.', 'suis')"
      ],
      'write'
    );
    const { id } = await startAssessment(client, learner, {
      language: 'fr',
      submissionKey: randomUUID()
    });
    expect(await getAssessment(client, learner, id)).toMatchObject({
      coverage: { A1: 1, A2: 0 }
    });
    await answer(id, 'fr-a1-001@1:h01', 'faux');
    expect(await assessmentResults(client, learner, id)).toMatchObject({
      foundationLevel: 'A1',
      foundationGaps: ['fr-a1-001']
    });
  });

  it('refuses an assessment for a track the learner is not enrolled in', async () => {
    await expect(
      startAssessment(client, learner, {
        language: 'pt',
        submissionKey: randomUUID()
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
