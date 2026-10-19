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
const ownerB = testSession('learner-b');

const french = {
  title: 'Être',
  explanation: 'Use être to say who you are.',
  examples: [{ fr: 'Je suis étudiant.', en: 'I am a student.' }],
  references: ['https://example.test/etre']
};
const english = {
  title: 'To be',
  explanation: 'Use be to say who you are.',
  examples: [{ en: 'I am a student.' }],
  references: ['https://example.test/be']
};
const englishPt = {
  title: 'Ser',
  explanation: 'Use be para dizer quem você é.',
  examples: [{ en: 'I am a student.', pt: 'Eu sou estudante.' }],
  references: ['https://pt.example.test/ser']
};
const german = {
  title: 'Sein',
  explanation: 'Use sein to say who you are.',
  examples: [{ de: 'Ich bin Student.', en: 'I am a student.' }],
  references: ['https://example.test/sein']
};

let client: Client;
let close: (() => void) | undefined;

function packageWithLessons(pt?: typeof englishPt): ContentPackage {
  const pkg = approvedPackage();
  Object.assign(pkg.versions[0], { lesson: french });
  pkg.skills.push({
    id: 'de-a1-001',
    language: 'de',
    level: 'A1',
    review: 'approved',
    prerequisites: []
  });
  pkg.skills.push({
    id: 'en-a1-001',
    language: 'en',
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
  pkg.versions.push({
    id: 'en-a1-001@1',
    skillId: 'en-a1-001',
    version: 1,
    review: 'approved',
    questions: [
      {
        id: 'en-a1-001@1:q1',
        format: 'typed-blank',
        prompt: 'I ___ a student.',
        answer: 'am'
      }
    ],
    lesson: english,
    ...(pt ? { translations: { pt } } : {})
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

const enrollEn = (owner: string, explanationLanguage: string) =>
  client.execute({
    sql: "INSERT INTO enrollments (id, owner_id, language, starting_level, explanation_language) VALUES (?, ?, 'en', 'A1', ?)",
    args: [`${owner}-enrollment-en`, owner, explanationLanguage]
  });

const createStudySession = (
  id: string,
  enrollmentId: string,
  language: string
) =>
  client.execute({
    sql: "INSERT INTO study_sessions (id, owner_id, enrollment_id, language, mode) VALUES (?, 'learner-a', ?, ?, 'practice')",
    args: [id, enrollmentId, language]
  });

describe('lesson translation import', () => {
  it('stores a Portuguese lesson next to an English lesson, with sorted example keys and distinct references', async () => {
    await importContent(client, packageWithLessons(englishPt));
    const rows = (
      await client.execute(
        'SELECT content_version_id, explanation_language, title, examples, refs FROM lesson_translations'
      )
    ).rows.map((row) => ({ ...row }));
    expect(rows).toEqual([
      {
        content_version_id: 'en-a1-001@1',
        explanation_language: 'pt',
        title: 'Ser',
        examples: JSON.stringify([
          { en: 'I am a student.', pt: 'Eu sou estudante.' }
        ]),
        refs: JSON.stringify(['https://pt.example.test/ser'])
      }
    ]);
    const english = await client.execute(
      "SELECT title FROM lessons WHERE content_version_id = 'en-a1-001@1'"
    );
    expect(english.rows[0].title).toBe('To be');
  });

  it('rejects a changed Portuguese text for the same version', async () => {
    await importContent(client, packageWithLessons(englishPt));
    const changed = packageWithLessons({ ...englishPt, explanation: 'Outro.' });
    changed.curriculumVersion = '0.2.0';
    const error = await importContent(client, changed).catch((e) => e);
    expect(error).toBeInstanceOf(ContentImportError);
    expect((error as ContentImportError).code).toBe('CONTENT_CONFLICT');
    expect(
      (
        await client.execute(
          "SELECT explanation FROM lesson_translations WHERE content_version_id = 'en-a1-001@1'"
        )
      ).rows[0].explanation
    ).toBe(englishPt.explanation);
  });

  it('rejects a translation on a version that has no lesson', async () => {
    const pkg = packageWithLessons();
    const version = pkg.versions.find((item) => item.id === 'en-a1-001@1')!;
    version.lesson = undefined;
    Object.assign(version, { translations: { pt: englishPt } });
    const error = await importContent(client, pkg).catch((e) => e);
    expect(error).toBeInstanceOf(ContentImportError);
    expect((error as ContentImportError).code).toBe('INVALID_PACKAGE');
    expect(
      (await client.execute('SELECT count(*) AS n FROM lesson_translations'))
        .rows[0].n
    ).toBe(0);
  });

  it('rejects a Portuguese translation attached to a non-English lesson', async () => {
    const pkg = packageWithLessons();
    Object.assign(
      pkg.versions.find((item) => item.id === 'fr-a1-001@1')!,
      {
        translations: { pt: englishPt }
      }
    );
    const error = await importContent(client, pkg).catch((e) => e);
    expect(error).toBeInstanceOf(ContentImportError);
    expect((error as ContentImportError).code).toBe('INVALID_PACKAGE');
    expect(
      (await client.execute('SELECT count(*) AS n FROM lesson_translations'))
        .rows[0].n
    ).toBe(0);
  });

  it.each([
    ['an unsupported language', 'translations', { de: englishPt }],
    ['a capitalized language key', 'translations', { PT: englishPt }],
    ['a misspelled field', 'translation', { pt: englishPt }]
  ])(
    'rejects %s instead of silently dropping it',
    async (_label, key, value) => {
      const pkg = packageWithLessons();
      Object.assign(
        pkg.versions.find((item) => item.id === 'en-a1-001@1')!,
        {
          [key]: value
        }
      );
      const error = await importContent(client, pkg).catch((e) => e);
      expect(error).toBeInstanceOf(ContentImportError);
      expect((error as ContentImportError).code).toBe('INVALID_PACKAGE');
      expect(
        (await client.execute('SELECT count(*) AS n FROM lesson_translations'))
          .rows[0].n
      ).toBe(0);
    }
  );

  it('re-imports the same Portuguese translation without changing its fingerprint or audit row', async () => {
    const pkg = packageWithLessons(englishPt);
    await importContent(client, pkg);
    const first = await client.execute(
      "SELECT fingerprint FROM lesson_translations WHERE content_version_id = 'en-a1-001@1'"
    );
    await importContent(client, pkg);
    const second = await client.execute(
      "SELECT fingerprint FROM lesson_translations WHERE content_version_id = 'en-a1-001@1'"
    );
    const changes = await client.execute(
      "SELECT count(*) AS n FROM content_changes WHERE kind = 'lesson-translation-added' AND content_version_id = 'en-a1-001@1'"
    );
    expect(second.rows[0].fingerprint).toBe(first.rows[0].fingerprint);
    expect(changes.rows[0].n).toBe(1);
  });

  it('requires a minor bump and audits a translation added to an existing version', async () => {
    await importContent(client, packageWithLessons());
    const translated = packageWithLessons(englishPt);
    translated.curriculumVersion = '0.1.1';
    const error = await importContent(client, translated).catch((e) => e);
    expect(error).toBeInstanceOf(ContentImportError);
    expect((error as ContentImportError).code).toBe('VERSION_BUMP');
    expect(
      (await client.execute('SELECT count(*) AS n FROM lesson_translations'))
        .rows[0].n
    ).toBe(0);

    translated.curriculumVersion = '0.2.0';
    await importContent(client, translated);
    const changes = await client.execute(
      "SELECT curriculum_version, skill_id, content_version_id FROM content_changes WHERE kind = 'lesson-translation-added'"
    );
    expect(changes.rows.map((row) => ({ ...row }))).toEqual([
      {
        curriculum_version: '0.2.0',
        skill_id: 'en-a1-001',
        content_version_id: 'en-a1-001@1'
      }
    ]);
  });
});

describe('lesson explanation language per learning language', () => {
  beforeEach(async () => {
    await importContent(client, packageWithLessons(englishPt));
  });

  it('serves Portuguese for English and English for German when set that way', async () => {
    await enrollEn('learner-a', 'pt');
    await enrollDe('en');
    expect(await getLesson(client, ownerA, 'en', 'en-a1-001')).toMatchObject({
      title: 'Ser',
      explanation: englishPt.explanation,
      examples: englishPt.examples,
      references: englishPt.references,
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
    await enrollEn('learner-a', 'pt');
    await enrollDe('pt');
    expect(await getLesson(client, ownerA, 'en', 'en-a1-001')).toMatchObject({
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
    await enrollEn('learner-a', 'en');
    expect(await getLesson(client, ownerA, 'en', 'en-a1-001')).toMatchObject({
      title: 'To be',
      explanationLanguage: 'en',
      englishFallback: false
    });
  });

  it('keeps each learner’s explanation language independent', async () => {
    await enrollEn('learner-a', 'pt');
    await enrollEn('learner-b', 'en');
    expect(await getLesson(client, ownerA, 'en', 'en-a1-001')).toMatchObject({
      title: 'Ser',
      explanationLanguage: 'pt',
      englishFallback: false
    });
    expect(await getLesson(client, ownerB, 'en', 'en-a1-001')).toMatchObject({
      title: 'To be',
      explanationLanguage: 'en',
      englishFallback: false
    });
  });

  it("serves the translation in a session's lesson", async () => {
    await enrollEn('learner-a', 'pt');
    await createStudySession('study-en', 'learner-a-enrollment-en', 'en');
    expect(
      await getSessionLesson(client, ownerA, 'study-en', 'en-a1-001')
    ).toMatchObject({ title: 'Ser', explanationLanguage: 'pt' });
  });

  it('shows the English fallback notice in a session when no translation exists', async () => {
    await enrollDe('pt');
    await createStudySession('study-de', 'enrollment-a-de', 'de');
    expect(
      await getSessionLesson(client, ownerA, 'study-de', 'de-a1-001')
    ).toMatchObject({
      title: 'Sein',
      explanationLanguage: 'en',
      englishFallback: true
    });
  });
});
