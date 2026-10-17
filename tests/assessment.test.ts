import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '@libsql/client';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { importContent } from '../src/lib/server/content-import';
import { getAttempt, recordAttempt } from '../src/lib/server/study';
import {
  assessmentResults,
  getAssessment,
  startAssessment
} from '../src/lib/server/assessment';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession
} from './fixtures/flashcards';
import { approvedPackage } from './fixtures/content-package';

const learner = testSession('learner-a');
let client: Client;
let close: () => void;
beforeEach(async () => {
  ({ client, close } = await openFixtureDatabase(await fixture()));
  const pkg = approvedPackage();
  pkg.versions[0].questions[1].holdout = true;
  pkg.versions[1].questions[0].holdout = true;
  await importContent(client, pkg);
});
afterEach(async () => {
  close?.();
  await disposeFlashcardFixtures();
});

const start = (language = 'fr', submissionKey: string = randomUUID()) =>
  startAssessment(client, learner, { language, submissionKey });
const answer = (
  id: string,
  questionId: string,
  value = 'es',
  notSure = false
) =>
  recordAttempt(client, learner, {
    studySessionId: id,
    questionId,
    submissionKey: randomUUID(),
    evidenceKind: 'independent',
    answer: value,
    notSure
  });

describe('saved placement plan', () => {
  it('refuses start-token reuse by another owner or in a different mode without altering history', async () => {
    const key = randomUUID();
    const { id } = await start('fr', key);
    await expect(
      startAssessment(client, testSession('learner-b'), {
        language: 'fr',
        submissionKey: key
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await client.execute({
      sql: "UPDATE study_sessions SET mode = 'practice' WHERE id = ?",
      args: [id]
    });
    await expect(start('fr', key)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(start('xx')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(
      (
        await client.execute({
          sql: 'SELECT owner_id, mode FROM study_sessions WHERE id = ?',
          args: [id]
        })
      ).rows
    ).toEqual([{ owner_id: 'learner-a', mode: 'practice' }]);
  });

  it('fails closed for unsupported, incomplete or oversized stored assessment plans', async () => {
    const { id } = await start();
    const saved = JSON.parse(
      String(
        (
          await client.execute({
            sql: 'SELECT assessment_plan FROM study_sessions WHERE id = ?',
            args: [id]
          })
        ).rows[0].assessment_plan
      )
    );
    for (const plan of [
      { ...saved, version: 'future-policy' },
      { ...saved, questions: [...saved.questions, 'missing-item'] },
      { ...saved, questions: Array(13).fill(saved.questions[0]) }
    ]) {
      await client.execute({
        sql: 'UPDATE study_sessions SET assessment_plan = ? WHERE id = ?',
        args: [JSON.stringify(plan), id]
      });
      await expect(getAssessment(client, learner, id)).rejects.toMatchObject({
        code: 'CONTENT_UNAVAILABLE'
      });
    }
    await expect(
      getAssessment(client, learner, null as unknown as string)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('keeps missing evaluation evidence uncertain after completion instead of manufacturing a correct result', async () => {
    const { id } = await start();
    const first = await answer(id, 'fr-a1-001@1:q2');
    await answer(id, 'fr-a1-002@1:q1', 'On est ici.');
    await client.execute({
      sql: 'DELETE FROM evaluations WHERE attempt_id = ?',
      args: [first.id]
    });
    expect(await assessmentResults(client, learner, id)).toMatchObject({
      counts: { correct: 1, incorrect: 0, uncertain: 1 },
      a1Gaps: ['fr-a1-001']
    });
  });

  it('persists an ordered holdout-only plan with no answer leaks on reload', async () => {
    const { id } = await start();
    const first = await getAssessment(client, learner, id);
    expect(first).toMatchObject({
      total: 2,
      answered: 0,
      state: 'active',
      coverage: { A1: 2, A2: 0 },
      question: { id: 'fr-a1-001@1:q2' }
    });
    expect(JSON.stringify(first)).not.toContain('Nous sommes ici.');
    expect(first.question).not.toHaveProperty('answer');
    expect(await getAssessment(client, learner, id)).toEqual(first);
    await client.execute(
      "UPDATE questions SET holdout = 0 WHERE id = 'fr-a1-002@1:q1'"
    );
    expect((await getAssessment(client, learner, id)).total).toBe(2);
  });

  it('replays start safely and refuses another owner and an unenrolled track', async () => {
    const key = randomUUID();
    const first = await start('fr', key);
    expect(await start('fr', key)).toEqual(first);
    await expect(
      getAssessment(client, testSession('learner-b'), first.id)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(start('de')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(start('fr', '../invalid')).rejects.toMatchObject({
      code: 'INVALID_SUBMISSION_KEY'
    });
  });

  it('refuses non-planned questions and out-of-order answers without saving', async () => {
    const { id } = await start();
    await expect(answer(id, 'fr-a1-001@1:q1', 'suis')).rejects.toMatchObject({
      code: 'STALE_QUESTION'
    });
    await expect(answer(id, 'fr-a1-002@1:q1')).rejects.toMatchObject({
      code: 'STALE_QUESTION'
    });
    expect((await getAssessment(client, learner, id)).answered).toBe(0);
  });

  it('keeps results hidden until the final committed answer and replays it afterwards', async () => {
    const { id } = await start();
    const recorded = await answer(id, 'fr-a1-001@1:q2');
    expect(
      (await getAttempt(client, learner, recorded.id)).evaluations
    ).toEqual([]);
    await expect(assessmentResults(client, learner, id)).rejects.toMatchObject({
      code: 'RESULTS_NOT_READY'
    });
    expect((await getAssessment(client, learner, id)).question?.id).toBe(
      'fr-a1-002@1:q1'
    );
    const input = {
      studySessionId: id,
      questionId: 'fr-a1-002@1:q1',
      submissionKey: randomUUID(),
      evidenceKind: 'independent' as const,
      answer: 'Nous sommes ici.'
    };
    const final = await recordAttempt(client, learner, input);
    expect(await recordAttempt(client, learner, input)).toEqual({
      id: final.id,
      duplicate: true
    });
    expect((await getAssessment(client, learner, id)).state).toBe('completed');
    expect(await assessmentResults(client, learner, id)).toMatchObject({
      counts: { correct: 2, incorrect: 0, uncertain: 0 },
      a1Gaps: []
    });
    expect(
      (await getAttempt(client, learner, recorded.id)).evaluations
    ).toHaveLength(1);
  });

  it('not sure stays uncertain even for multiple choice and never invokes fallback', async () => {
    await client.execute(
      "UPDATE questions SET holdout = 1 WHERE id = 'fr-a1-001@1:q1'"
    );
    const { id } = await start();
    const fallback = vi.fn();
    const result = await recordAttempt(
      client,
      learner,
      {
        studySessionId: id,
        questionId: 'fr-a1-001@1:q1',
        submissionKey: randomUUID(),
        evidenceKind: 'independent',
        answer: '',
        notSure: true
      },
      { fallback }
    );
    expect(fallback).not.toHaveBeenCalled();
    const row = await client.execute({
      sql: 'SELECT a.not_sure, e.outcome FROM attempts a JOIN evaluations e ON e.attempt_id = a.id WHERE a.id = ?',
      args: [result.id]
    });
    expect(row.rows[0]).toMatchObject({ not_sure: 1, outcome: 'uncertain' });
  });

  it('holds results while a fresh final answer awaits its fallback verdict, then publishes', async () => {
    const { id } = await start();
    await answer(id, 'fr-a1-001@1:q2');
    const during: unknown[] = [];
    const fallback = vi.fn(async () => {
      const code = (error: unknown) => (error as { code?: string }).code;
      during.push(
        await assessmentResults(client, learner, id, {
          awaitFallback: true
        }).catch(code),
        await assessmentResults(client, learner, id, {
          awaitFallback: true,
          now: Date.now() + 16_000
        }).then(() => 'published'),
        await assessmentResults(client, learner, id).then(() => 'published')
      );
      return {
        outcome: 'correct' as const,
        reason: 'answered' as const,
        evaluated: true as const
      };
    });
    await recordAttempt(
      client,
      learner,
      {
        studySessionId: id,
        questionId: 'fr-a1-002@1:q1',
        submissionKey: randomUUID(),
        evidenceKind: 'independent',
        answer: 'Nous voici.'
      },
      { fallback }
    );
    expect(during).toEqual(['RESULTS_PENDING', 'published', 'published']);
    expect(
      await assessmentResults(client, learner, id, { awaitFallback: true })
    ).toMatchObject({ counts: { correct: 2, incorrect: 0, uncertain: 0 } });
  });

  it('records uncertainty and identifies A1 gaps without writing mastery or cards', async () => {
    const { id } = await start();
    await answer(id, 'fr-a1-001@1:q2', '', true);
    await answer(id, 'fr-a1-002@1:q1', 'On est ici.');
    const results = await assessmentResults(client, learner, id);
    expect(results).toMatchObject({
      counts: { correct: 1, incorrect: 0, uncertain: 1 },
      a1Gaps: ['fr-a1-001']
    });
    expect(
      (await client.execute('SELECT * FROM skill_evidence')).rows
    ).toHaveLength(0);
    expect(
      (await client.execute('SELECT * FROM card_drafts')).rows
    ).toHaveLength(0);
  });

  it('checks quarantine again before a displayed question is submitted', async () => {
    const { id } = await start();
    await getAssessment(client, learner, id);
    await client.execute(
      "UPDATE content_versions SET status = 'quarantined' WHERE id = 'fr-a1-001@1'"
    );
    await expect(answer(id, 'fr-a1-001@1:q2')).rejects.toMatchObject({
      code: 'CONTENT_UNAVAILABLE'
    });
    await expect(getAssessment(client, learner, id)).rejects.toMatchObject({
      code: 'CONTENT_UNAVAILABLE'
    });
  });

  it('does not resample previously exposed holdouts or silently fall back to practice', async () => {
    const { id } = await start();
    await answer(id, 'fr-a1-001@1:q2');
    await answer(id, 'fr-a1-002@1:q1', 'On est ici.');
    await expect(start()).rejects.toMatchObject({
      code: 'CONTENT_UNAVAILABLE'
    });
  });

  it('samples A1 gaps for an A2 enrollment and caps the plan deterministically', async () => {
    await client.execute(
      "INSERT INTO enrollments (id, owner_id, language, starting_level, explanation_language) VALUES ('en-a', 'learner-a', 'en', 'A2', 'en')"
    );
    for (const level of ['A1', 'A2']) {
      for (let i = 0; i < 8; i++) {
        const skill = `en-${level}-${i}`;
        await client.batch(
          [
            {
              sql: 'INSERT INTO skills (id, language, level) VALUES (?, ?, ?)',
              args: [skill, 'en', level]
            },
            {
              sql: "INSERT INTO content_versions (id, skill_id, language, version, status) VALUES (?, ?, 'en', 1, 'pilot-ready')",
              args: [`${skill}@1`, skill]
            },
            {
              sql: "INSERT INTO questions (id, content_version_id, skill_id, language, format, holdout, prompt, answer) VALUES (?, ?, ?, 'en', 'typed-blank', 1, 'Synthetic prompt', 'yes')",
              args: [`${skill}:q`, `${skill}@1`, skill]
            }
          ],
          'write'
        );
      }
    }
    const { id } = await start('en');
    expect(await getAssessment(client, learner, id)).toMatchObject({
      total: 12,
      coverage: { A1: 6, A2: 6 },
      question: { id: 'en-A1-0:q' }
    });
  });
});
