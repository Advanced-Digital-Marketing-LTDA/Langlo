import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { importContent } from '../src/lib/server/content-import';
import {
  listContentReports,
  reportContentIssue
} from '../src/lib/server/content-reports';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession
} from './fixtures/flashcards';
import { approvedPackage } from './fixtures/content-package';
import { recordAttempt } from '../src/lib/server/study';

const learner = testSession('learner-a');
let client: Client;
let close: () => void;
beforeEach(async () => {
  ({ client, close } = await openFixtureDatabase(await fixture()));
  const pkg = approvedPackage();
  pkg.versions[0].lesson = {
    title: 'Synthetic lesson',
    explanation: 'Synthetic',
    examples: [],
    references: []
  };
  pkg.versions[0].questions[1].holdout = true;
  await importContent(client, pkg);
});
afterEach(async () => {
  close?.();
  await disposeFlashcardFixtures();
});
const input = () => ({
  submissionKey: randomUUID(),
  contentVersionId: 'fr-a1-001@1',
  questionId: 'fr-a1-001@1:q1' as string | null,
  category: 'incorrect-answer',
  comment: ''
});

it('saves exact item/version, bounded text and idempotent identity without changing content', async () => {
  const before = (await client.execute('SELECT * FROM questions ORDER BY id'))
    .rows;
  const request = { ...input(), comment: '<script>synthetic report</script>' };
  const saved = await reportContentIssue(client, learner, request);
  expect(await reportContentIssue(client, learner, request)).toEqual({
    id: saved.id,
    duplicate: true
  });
  expect(await listContentReports(client, learner)).toMatchObject([
    {
      contentVersionId: request.contentVersionId,
      questionId: request.questionId,
      comment: request.comment
    }
  ]);
  expect(await listContentReports(client, testSession('learner-b'))).toEqual(
    []
  );
  expect(
    (await client.execute('SELECT * FROM questions ORDER BY id')).rows
  ).toEqual(before);
  await expect(
    reportContentIssue(client, learner, { ...request, category: 'unclear' })
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
});

it('accepts a lesson report and the Unicode boundary but refuses invalid comments and categories', async () => {
  await reportContentIssue(client, learner, {
    ...input(),
    questionId: null,
    comment: '😀'.repeat(1000)
  });
  for (const comment of ['😀'.repeat(1001), 'text\0bad'])
    await expect(
      reportContentIssue(client, learner, { ...input(), comment })
    ).rejects.toMatchObject({ code: 'INVALID_REPORT' });
  await expect(
    reportContentIssue(client, learner, {
      ...input(),
      comment: '\u0344'.repeat(1000)
    })
  ).rejects.toMatchObject({ code: 'INVALID_REPORT' });
  await expect(
    reportContentIssue(client, learner, { ...input(), category: 'forged' })
  ).rejects.toMatchObject({ code: 'INVALID_REPORT' });
  await expect(
    reportContentIssue(client, learner, {
      ...input(),
      submissionKey: '../path'
    })
  ).rejects.toMatchObject({ code: 'INVALID_REPORT' });
});

it('refuses forged version/item/owner access and uncompleted assessment holdouts', async () => {
  for (const request of [
    { ...input(), contentVersionId: 'missing' },
    { ...input(), questionId: 'fr-a1-002@1:q1' },
    { ...input(), questionId: 'fr-a1-001@1:q2' }
  ])
    await expect(
      reportContentIssue(client, learner, request)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(
    reportContentIssue(client, testSession('missing-owner'), input())
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const holdout = { ...input(), questionId: 'fr-a1-001@1:q2' };
  await recordAttempt(client, testSession('learner-b'), {
    studySessionId: 'study-b',
    questionId: holdout.questionId,
    submissionKey: 'holdout',
    evidenceKind: 'independent',
    answer: 'es'
  });
  await expect(
    reportContentIssue(client, testSession('learner-b'), holdout)
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await client.execute(
    "UPDATE study_sessions SET state = 'completed' WHERE id = 'study-b'"
  );
  expect(
    await reportContentIssue(client, testSession('learner-b'), holdout)
  ).toMatchObject({ duplicate: false });
});

it('enforces the daily bound but lets a replay through when full', async () => {
  const request = input();
  const saved = await reportContentIssue(client, learner, request);
  await client.execute({
    sql: "INSERT INTO content_reports (id, owner_id, submission_key, content_version_id, skill_id, language, question_id, category, comment) SELECT 'bulk-' || value, 'learner-a', 'key-' || value, 'fr-a1-001@1', 'fr-a1-001', 'fr', 'fr-a1-001@1:q1', 'other', '' FROM json_each(?)",
    args: [JSON.stringify(Array.from({ length: 99 }, (_, i) => i))]
  });
  await expect(
    reportContentIssue(client, learner, input())
  ).rejects.toMatchObject({ code: 'REPORT_LIMIT' });
  expect(await reportContentIssue(client, learner, request)).toEqual({
    id: saved.id,
    duplicate: true
  });
});

it('keeps original attempt rubrics and reports when a reviewed correction creates a new version', async () => {
  const original = await recordAttempt(client, learner, {
    studySessionId: 'study-a',
    questionId: 'fr-a1-001@1:q1',
    submissionKey: 'original-response',
    evidenceKind: 'independent',
    answer: 'suis'
  });
  await reportContentIssue(client, learner, input());
  const corrected = approvedPackage();
  corrected.curriculumVersion = '0.2.0';
  const version = corrected.versions[0];
  version.id = 'fr-a1-001@2';
  version.version = 2;
  version.lesson = {
    title: 'Corrected synthetic lesson',
    explanation: 'Reviewed correction',
    examples: [],
    references: []
  };
  for (const question of version.questions)
    question.id = question.id.replace('@1:', '@2:');
  version.questions[1].holdout = true;
  await importContent(client, corrected);
  expect(
    (
      await client.execute({
        sql: 'SELECT content_version_id FROM attempts WHERE id = ?',
        args: [original.id]
      })
    ).rows[0].content_version_id
  ).toBe('fr-a1-001@1');
  expect(
    (
      await client.execute({
        sql: 'SELECT rubric_version FROM evaluations WHERE attempt_id = ?',
        args: [original.id]
      })
    ).rows[0].rubric_version
  ).toBe('fr-a1-001@1');
  expect((await listContentReports(client, learner))[0].contentVersionId).toBe(
    'fr-a1-001@1'
  );
});
