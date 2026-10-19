import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import {
  ContentImportError,
  importContent,
  type ContentPackage
} from '../src/lib/server/content-import';
import { getLesson, getSessionLesson } from '../src/lib/server/study';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession
} from './fixtures/flashcards';
import { approvedPackage } from './fixtures/content-package';

// Synthetic lessons and principals: these prove that the explanation language
// is stored per learning language and read per lesson, not real curriculum.
const ownerA = testSession('learner-a');

const french = {
  title: 'Être',
  explanation: 'Use être to say who you are.',
  examples: [{ fr: 'Je suis étudiant.', en: 'I am a student.' }],
  references: ['https://example.test/etre']
};
const frenchPt = {
  title: 'Ser',
  explanation: 'Use être para dizer quem você é.',
  examples: [{ fr: 'Je suis étudiant.', pt: 'Eu sou estudante.' }],
  references: ['https://example.test/etre']
};
const german = {
  title: 'Sein',
  explanation: 'Use sein to say who you are.',
  examples: [{ de: 'Ich bin Student.', en: 'I am a student.' }],
  references: ['https://example.test/sein']
};

let client: Client;
let close: (() => void) | undefined;

function packageWithLessons(pt?: typeof frenchPt): ContentPackage {
  const pkg = approvedPackage();
  Object.assign(pkg.versions[0], {
    lesson: french,
    ...(pt ? { translations: { pt } } : {})
  });
  pkg.skills.push({
    id: 'de-a1-001',
    language: 'de',
    level: 'A1',
    review: 'approved',
    prerequisites: []
  });
  pkg.versions.push({
    id: 'de-a1-001@1',
    skillId: 'de-a1-001',
    version: 1,
    review: 'approved',
    questions: [
      {
        id: 'de-a1-001@1:q1',
        format: 'typed-blank',
        prompt: 'Ich ___ Student.',
        answer: 'bin'
      }
    ],
    lesson: german
  });
  return pkg;
}

beforeEach(async () => {
  ({ client, close } = await openFixtureDatabase(await fixture()));
});

afterEach(async () => {
  close?.();
  close = undefined;
  await disposeFlashcardFixtures();
});

const enrollDe = (explanationLanguage: string) =>
  client.execute({
    sql: "INSERT INTO enrollments (id, owner_id, language, starting_level, explanation_language) VALUES ('enrollment-a-de', 'learner-a', 'de', 'A1', ?)",
    args: [explanationLanguage]
  });

const setFr = (explanationLanguage: string) =>
  client.execute({
    sql: "UPDATE enrollments SET explanation_language = ? WHERE id = 'enrollment-a'",
    args: [explanationLanguage]
  });

describe('lesson translation import', () => {
  it('stores a Portuguese lesson next to the English one, example keys sorted', async () => {
    await importContent(client, packageWithLessons(frenchPt));
    const rows = (
      await client.execute(
        'SELECT content_version_id, explanation_language, title, examples FROM lesson_translations'
      )
    ).rows.map((row) => ({ ...row }));
    expect(rows).toEqual([
      {
        content_version_id: 'fr-a1-001@1',
        explanation_language: 'pt',
        title: 'Ser',
        examples: JSON.stringify([
          { fr: 'Je suis étudiant.', pt: 'Eu sou estudante.' }
        ])
      }
    ]);
    const english = await client.execute(
      "SELECT title FROM lessons WHERE content_version_id = 'fr-a1-001@1'"
    );
    expect(english.rows[0].title).toBe('Être');
  });

  it('rejects a changed Portuguese text for the same version', async () => {
    await importContent(client, packageWithLessons(frenchPt));
    const changed = packageWithLessons({ ...frenchPt, explanation: 'Outro.' });
    changed.curriculumVersion = '0.2.0';
    const error = await importContent(client, changed).catch((e) => e);
    expect(error).toBeInstanceOf(ContentImportError);
    expect((error as ContentImportError).code).toBe('CONTENT_CONFLICT');
    expect(
      (
        await client.execute(
          "SELECT explanation FROM lesson_translations WHERE content_version_id = 'fr-a1-001@1'"
        )
      ).rows[0].explanation
    ).toBe(frenchPt.explanation);
  });

  it('rejects a translation on a version that has no English lesson', async () => {
    const pkg = approvedPackage();
    Object.assign(pkg.versions[0], { translations: { pt: frenchPt } });
    const error = await importContent(client, pkg).catch((e) => e);
    expect(error).toBeInstanceOf(ContentImportError);
    expect((error as ContentImportError).code).toBe('INVALID_PACKAGE');
    expect(
      (await client.execute('SELECT count(*) AS n FROM lesson_translations'))
        .rows[0].n
    ).toBe(0);
  });
});

describe('lesson explanation language per learning language', () => {
  beforeEach(async () => {
    await importContent(client, packageWithLessons(frenchPt));
  });

  it('serves Portuguese for French and English for German when set that way', async () => {
    await setFr('pt');
    await enrollDe('en');
    expect(await getLesson(client, ownerA, 'fr', 'fr-a1-001')).toMatchObject({
      title: 'Ser',
      explanation: frenchPt.explanation,
      examples: frenchPt.examples,
      explanationLanguage: 'pt',
      englishFallback: false
    });
    expect(await getLesson(client, ownerA, 'de', 'de-a1-001')).toMatchObject({
      title: 'Sein',
      explanationLanguage: 'en',
      englishFallback: false
    });
  });

  it('falls back to English loudly only where no translation exists', async () => {
    await setFr('pt');
    await enrollDe('pt');
    expect(await getLesson(client, ownerA, 'fr', 'fr-a1-001')).toMatchObject({
      explanationLanguage: 'pt',
      englishFallback: false
    });
    expect(await getLesson(client, ownerA, 'de', 'de-a1-001')).toMatchObject({
      title: 'Sein',
      explanationLanguage: 'en',
      englishFallback: true
    });
  });

  it('keeps English for an English enrollment even when a translation exists', async () => {
    expect(await getLesson(client, ownerA, 'fr', 'fr-a1-001')).toMatchObject({
      title: 'Être',
      explanationLanguage: 'en',
      englishFallback: false
    });
  });

  it("serves the translation in a session's lesson", async () => {
    await setFr('pt');
    expect(
      await getSessionLesson(client, ownerA, 'study-a', 'fr-a1-001')
    ).toMatchObject({ title: 'Ser', explanationLanguage: 'pt' });
  });
});
