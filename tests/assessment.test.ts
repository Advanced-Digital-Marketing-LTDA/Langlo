import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '@libsql/client';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { importContent } from '../src/lib/server/content-import';
import {
  getAttempt,
  discardUnratedAssessmentAnswer,
  rateGrammarAttempt,
  recordAttempt,
  pauseStudySession,
  resumeStudySession
} from '../src/lib/server/study';
import {
  assessmentResults,
  completeAssessment,
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

async function addHoldoutSkills(
  skills: { id: string; language: string; level: string }[],
  existing = false
) {
  await client.batch(
    [
      ...(existing
        ? []
        : skills.map((skill) => ({
            sql: 'INSERT INTO skills (id, language, level) VALUES (?, ?, ?)',
            args: [skill.id, skill.language, skill.level]
          }))),
      ...skills.map((skill) => ({
        sql: "INSERT INTO content_versions (id, skill_id, language, version, status) VALUES (?, ?, ?, 1, 'pilot-ready')",
        args: [`${skill.id}@1`, skill.id, skill.language]
      })),
      ...skills.map((skill) => ({
        sql: "INSERT INTO questions (id, content_version_id, skill_id, language, format, holdout, prompt, answer) VALUES (?, ?, ?, ?, 'typed-blank', 1, ?, 'es')",
        args: [
          `${skill.id}@1:q1`,
          `${skill.id}@1`,
          skill.id,
          skill.language,
          `Synthetic prompt for ${skill.id}`
        ]
      }))
    ],
    'write'
  );
}

beforeEach(async () => {
  ({ client, close } = await openFixtureDatabase(await fixture()));
  const pkg = approvedPackage();
  pkg.versions[0].questions[1].holdout = true;
  pkg.versions[1].questions[0].holdout = true;
  await importContent(client, pkg);
  await client.execute(
    "UPDATE skills SET retired_at = 1 WHERE id = 'fr-articles'"
  );
  await addHoldoutSkills(
    [{ id: 'fr-a1-003', language: 'fr', level: 'A1' }],
    true
  );
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

async function expandedAssessment(format = 'typed-blank') {
  await addHoldoutSkills(
    Array.from({ length: 6 }, (_, index) => ({
      id: `fr-a1-00${index + 4}`,
      language: 'fr',
      level: 'A1'
    }))
  );
  await client.execute({
    sql: 'UPDATE questions SET format = ?, answer = ?, alternatives = ?',
    args: [
      format,
      'es',
      JSON.stringify(format === 'multiple-choice' ? ['es', 'wrong'] : [])
    ]
  });
  return start();
}

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

  it('starts only when every active skill has an unseen assessment holdout', async () => {
    await client.execute({
      sql: "DELETE FROM questions WHERE id = 'fr-a1-003@1:q1'"
    });
    await expect(start()).rejects.toMatchObject({
      code: 'CONTENT_UNAVAILABLE'
    });
    expect(
      (
        await client.execute(
          "SELECT COUNT(*) AS count FROM study_sessions WHERE mode = 'assessment' AND assessment_plan IS NOT NULL"
        )
      ).rows[0].count
    ).toBe(0);
  });

  it('writes new full-coverage plans and still reads saved assessment-1 plans', async () => {
    const { id } = await start();
    const stored = await client.execute({
      sql: 'SELECT assessment_plan FROM study_sessions WHERE id = ?',
      args: [id]
    });
    const plan = JSON.parse(String(stored.rows[0].assessment_plan));
    expect(plan.version).toBe('assessment-2');
    expect(plan.questions).toHaveLength(3);
    await client.execute({
      sql: 'UPDATE study_sessions SET assessment_plan = ? WHERE id = ?',
      args: [
        JSON.stringify({
          version: 'assessment-1',
          questions: plan.questions.slice(0, 2)
        }),
        id
      ]
    });
    expect(await getAssessment(client, learner, id)).toMatchObject({
      total: 2,
      policyVersion: 'assessment-1'
    });
  });

  it('keeps missing evaluation evidence uncertain after completion instead of manufacturing a correct result', async () => {
    const { id } = await start();
    const first = await answer(id, 'fr-a1-001@1:q2');
    await answer(id, 'fr-a1-002@1:q1', 'On est ici.');
    await answer(id, 'fr-a1-003@1:q1', 'es');
    await client.execute({
      sql: 'DELETE FROM evaluations WHERE attempt_id = ?',
      args: [first.id]
    });
    expect(await assessmentResults(client, learner, id)).toMatchObject({
      counts: { correct: 2, incorrect: 0, uncertain: 1 },
      foundationGaps: ['fr-a1-001']
    });
  });

  it('persists an ordered holdout-only plan with no answer leaks on reload', async () => {
    const { id } = await start();
    const first = await getAssessment(client, learner, id);
    expect(first).toMatchObject({
      total: 3,
      answered: 0,
      state: 'active',
      coverage: { A1: 3, A2: 0 },
      question: { id: 'fr-a1-001@1:q2' }
    });
    expect(JSON.stringify(first)).not.toContain('Nous sommes ici.');
    expect(first.question).not.toHaveProperty('answer');
    expect(await getAssessment(client, learner, id)).toEqual(first);
    await client.execute(
      "UPDATE questions SET holdout = 0 WHERE id = 'fr-a1-002@1:q1'"
    );
    expect((await getAssessment(client, learner, id)).total).toBe(3);
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
    await answer(id, 'fr-a1-003@1:q1', 'es');
    expect((await getAssessment(client, learner, id)).state).toBe('active');
    const results = await assessmentResults(client, learner, id);
    expect(results).toMatchObject({
      counts: { correct: 3, incorrect: 0, uncertain: 0 },
      foundationGaps: []
    });
    for (const item of results.items)
      await rateGrammarAttempt(client, learner, {
        attemptId: item.attemptId,
        rating: 'good',
        expectedSessionId: id
      });
    expect((await getAssessment(client, learner, id)).state).toBe('completed');
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

  async function assessmentWithSixAnswers() {
    await addHoldoutSkills(
      ['fr-a1-004', 'fr-a1-005', 'fr-a1-006', 'fr-a1-007', 'fr-a1-008'].map(
        (id) => ({ id, language: 'fr', level: 'A1' })
      )
    );
    const { id } = await start();
    const questions = [
      'fr-a1-001@1:q2',
      'fr-a1-002@1:q1',
      'fr-a1-003@1:q1',
      'fr-a1-004@1:q1',
      'fr-a1-005@1:q1',
      'fr-a1-006@1:q1',
      'fr-a1-007@1:q1',
      'fr-a1-008@1:q1'
    ];
    const certain = await answer(id, questions[0], 'es');
    await answer(id, questions[1], '', true);
    await answer(id, questions[2], '?');
    await answer(id, questions[3], '', true);
    await answer(id, questions[4], '', true);
    await answer(id, questions[5], '', true);
    return { id, questions, certain };
  }

  it('saves a partial result after the fifth explicit Not sure and counts only certain answers as evidence', async () => {
    const { id, questions, certain } = await assessmentWithSixAnswers();
    expect(await getAssessment(client, learner, id)).toMatchObject({
      total: 8,
      answered: 6,
      state: 'active'
    });
    await expect(assessmentResults(client, learner, id)).rejects.toMatchObject({
      code: 'RESULTS_NOT_READY'
    });

    await answer(id, questions[6], '', true);
    expect(await getAssessment(client, learner, id)).toMatchObject({
      total: 8,
      answered: 7,
      state: 'active',
      question: null
    });
    const results = await assessmentResults(client, learner, id);
    expect(results).toMatchObject({
      total: 8,
      notReached: 1,
      counts: { correct: 1, incorrect: 0, uncertain: 6 }
    });
    expect(results.items.map((item) => item.questionId)).toEqual(
      questions.slice(0, 7)
    );
    expect(results.items.some((item) => item.questionId === questions[7])).toBe(
      false
    );
    expect(
      (
        await client.execute(
          'SELECT attempt_id, contribution FROM skill_evidence'
        )
      ).rows
    ).toEqual([]);
    await rateGrammarAttempt(client, learner, {
      attemptId: certain.id,
      rating: 'good',
      expectedSessionId: id
    });
    expect(await getAssessment(client, learner, id)).toMatchObject({
      state: 'completed',
      question: null
    });
    expect(
      (
        await client.execute(
          'SELECT attempt_id, contribution FROM skill_evidence'
        )
      ).rows
    ).toEqual([{ attempt_id: certain.id, contribution: 1 }]);
  });

  function stoppedAssessmentSubmitter(id: string) {
    return async (value: string, notSure = false) => {
      const question = (await getAssessment(client, learner, id)).question!;
      const input = {
        studySessionId: id,
        questionId: question.id,
        submissionKey: randomUUID(),
        evidenceKind: 'independent' as const,
        answer: value,
        notSure
      };
      const options = {
        fallback: async () => ({
          outcome: 'incorrect' as const,
          reason: 'answered' as const,
          evaluated: true as const
        })
      };
      const result = await recordAttempt(client, learner, input, options);
      expect(await recordAttempt(client, learner, input, options)).toEqual({
        id: result.id,
        duplicate: true
      });
    };
  }

  it.each(['prepared', 'fallback'] as const)(
    'saves partial results on the fifth confirmed wrong answer from %s',
    async (evaluation) => {
      const { id } = await expandedAssessment(
        evaluation === 'prepared' ? 'multiple-choice' : 'typed-blank'
      );
      const submit = stoppedAssessmentSubmitter(id);
      for (let i = 0; i < 4; i++) await submit('wrong');
      await submit('', true);
      await submit('es');
      expect(await getAssessment(client, learner, id)).toMatchObject({
        state: 'active',
        answered: 6
      });
      await expect(
        assessmentResults(client, learner, id)
      ).rejects.toMatchObject({ code: 'RESULTS_NOT_READY' });
      await submit('wrong');
      expect(await getAssessment(client, learner, id)).toMatchObject({
        state: 'active',
        answered: 7,
        question: null
      });
      const results = await assessmentResults(client, learner, id);
      expect(results).toMatchObject({
        total: 9,
        notReached: 2,
        counts: { correct: 1, incorrect: 5, uncertain: 1 }
      });
      for (const item of results.items)
        if (item.outcome === 'correct' && item.rating === null)
          await rateGrammarAttempt(client, learner, {
            attemptId: item.attemptId,
            rating: 'good',
            expectedSessionId: id
          });
      expect(await getAssessment(client, learner, id)).toMatchObject({
        state: 'completed',
        question: null
      });
      const evidence = await client.execute({
        sql: `SELECT COUNT(*) AS total, SUM(se.contribution) AS correct
          FROM skill_evidence se JOIN attempts a ON a.id = se.attempt_id AND a.owner_id = se.owner_id
          WHERE a.study_session_id = ? AND se.owner_id = ?`,
        args: [id, learner.userId]
      });
      expect(evidence.rows).toEqual([{ total: 6, correct: 1 }]);
      await expect(answer(id, 'fr-a1-008@1:q1')).rejects.toMatchObject({
        code: 'SESSION_NOT_ACTIVE'
      });
    }
  );

  it('completes a paused assessment when its fifth wrong fallback verdict arrives', async () => {
    const { id } = await expandedAssessment('multiple-choice');
    for (let index = 0; index < 4; index++) {
      const question = (await getAssessment(client, learner, id)).question!;
      await answer(id, question.id, 'wrong');
    }
    const question = (await getAssessment(client, learner, id)).question!;
    await client.execute({
      sql: "UPDATE questions SET format = 'typed-blank', alternatives = '[]' WHERE id = ?",
      args: [question.id]
    });
    await recordAttempt(
      client,
      learner,
      {
        studySessionId: id,
        questionId: question.id,
        submissionKey: randomUUID(),
        evidenceKind: 'independent',
        answer: 'wrong'
      },
      {
        fallback: async () => {
          await pauseStudySession(client, learner, id, 123);
          return { outcome: 'incorrect', reason: 'answered', evaluated: true };
        }
      }
    );
    expect(await getAssessment(client, learner, id)).toMatchObject({
      state: 'completed',
      answered: 5,
      question: null
    });
    expect(
      (
        await client.execute({
          sql: 'SELECT paused_at FROM study_sessions WHERE id = ?',
          args: [id]
        })
      ).rows
    ).toEqual([{ paused_at: null }]);
    expect(await assessmentResults(client, learner, id)).toMatchObject({
      notReached: 4,
      counts: { correct: 0, incorrect: 5, uncertain: 0 }
    });
    const evidence = await client.execute({
      sql: `SELECT COUNT(*) AS total FROM skill_evidence se JOIN attempts a ON a.id = se.attempt_id AND a.owner_id = se.owner_id
        WHERE a.study_session_id = ? AND se.owner_id = ?`,
      args: [id, learner.userId]
    });
    expect(evidence.rows).toEqual([{ total: 5 }]);
    await expect(resumeStudySession(client, learner, id)).rejects.toMatchObject(
      { code: 'SESSION_NOT_ACTIVE' }
    );
    await expect(answer(id, 'fr-a1-006@1:q1')).rejects.toMatchObject({
      code: 'SESSION_NOT_ACTIVE'
    });
  });

  it('keeps four wrong answers plus an unresolved verdict active until a fifth wrong answer', async () => {
    const { id } = await expandedAssessment('multiple-choice');
    for (let index = 0; index < 4; index++) {
      const question = (await getAssessment(client, learner, id)).question!;
      await answer(id, question.id, 'wrong');
    }
    const question = (await getAssessment(client, learner, id)).question!;
    await client.execute({
      sql: "UPDATE questions SET format = 'typed-blank', alternatives = '[]' WHERE id = ?",
      args: [question.id]
    });
    await recordAttempt(
      client,
      learner,
      {
        studySessionId: id,
        questionId: question.id,
        submissionKey: randomUUID(),
        evidenceKind: 'independent',
        answer: 'unresolved'
      },
      {
        fallback: async () => ({
          outcome: 'uncertain',
          reason: 'timeout',
          evaluated: false
        })
      }
    );
    expect(await getAssessment(client, learner, id)).toMatchObject({
      state: 'active',
      answered: 5
    });
    await expect(assessmentResults(client, learner, id)).rejects.toMatchObject({
      code: 'RESULTS_NOT_READY'
    });
    await answer(
      id,
      (await getAssessment(client, learner, id)).question!.id,
      'wrong'
    );
    expect(await assessmentResults(client, learner, id)).toMatchObject({
      notReached: 3,
      counts: { correct: 0, incorrect: 5, uncertain: 1 }
    });
  });

  it.each([
    { owner: 'learner-b', mode: 'assessment' },
    { owner: 'learner-a', mode: 'practice' }
  ])(
    'ignores five wrong answers in $owner / $mode when checking completion',
    async ({ owner, mode }) => {
      const own = await expandedAssessment('multiple-choice');
      const other = await startAssessment(client, testSession(owner), {
        language: 'fr',
        submissionKey: randomUUID()
      });
      await client.execute({
        sql: 'UPDATE study_sessions SET mode = ? WHERE id = ?',
        args: [mode, other.id]
      });
      await client.execute({
        sql: `INSERT INTO attempts (id, owner_id, study_session_id, question_id, content_version_id, skill_id, language, submission_key, evidence_kind, answer)
        SELECT ? || ':' || q.id, ?, ?, q.id, q.content_version_id, q.skill_id, q.language, ? || ':' || q.id, 'independent', 'wrong'
        FROM study_sessions s JOIN json_each(s.assessment_plan, '$.questions') p JOIN questions q ON q.id = p.value
        WHERE s.id = ? ORDER BY CAST(p.key AS INTEGER) LIMIT 5`,
        args: [other.id, owner, other.id, other.id, other.id]
      });
      await client.execute({
        sql: `INSERT INTO evaluations (id, owner_id, attempt_id, evaluator_version, rubric_version, outcome)
        SELECT 'evaluation:' || id, owner_id, id, 'prepared-1', content_version_id, 'incorrect' FROM attempts WHERE study_session_id = ?`,
        args: [other.id]
      });
      expect(await completeAssessment(client, learner, other.id)).toBe(false);
      expect(await completeAssessment(client, learner, own.id)).toBe(false);
      expect(
        (
          await client.execute({
            sql: 'SELECT state FROM study_sessions WHERE id IN (?, ?) ORDER BY id',
            args: [own.id, other.id]
          })
        ).rows
      ).toEqual([{ state: 'active' }, { state: 'active' }]);
      if (mode === 'assessment')
        expect(
          await completeAssessment(client, testSession(owner), other.id)
        ).toBe(true);
    }
  );

  it('holds results while a fresh final answer awaits its fallback verdict, then publishes', async () => {
    const { id } = await start();
    await answer(id, 'fr-a1-001@1:q2');
    await answer(id, 'fr-a1-002@1:q1', 'On est ici.');
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
        questionId: 'fr-a1-003@1:q1',
        submissionKey: randomUUID(),
        evidenceKind: 'independent',
        answer: 'Nous voici.'
      },
      { fallback }
    );
    expect(during).toEqual(['RESULTS_PENDING', 'published', 'published']);
    expect(
      await assessmentResults(client, learner, id, { awaitFallback: true })
    ).toMatchObject({ counts: { correct: 3, incorrect: 0, uncertain: 0 } });
  });

  it.each(['timeout', 'provider-error', 'cap-reached'] as const)(
    'publishes results at once when the fallback ended with %s and no verdict',
    async (reason) => {
      const { id } = await start();
      await answer(id, 'fr-a1-001@1:q2');
      await answer(id, 'fr-a1-002@1:q1', 'On est ici.');
      await recordAttempt(
        client,
        learner,
        {
          studySessionId: id,
          questionId: 'fr-a1-003@1:q1',
          submissionKey: randomUUID(),
          evidenceKind: 'independent',
          answer: 'Nous voici.'
        },
        {
          fallback: async () => ({
            outcome: 'uncertain' as const,
            reason,
            evaluated: false as const
          })
        }
      );
      expect(
        await assessmentResults(client, learner, id, { awaitFallback: true })
      ).toMatchObject({ counts: { correct: 2, incorrect: 0, uncertain: 1 } });
    }
  );

  it('hides rating controls for completed assessments without the retention policy', async () => {
    const { id } = await start();
    await client.execute({
      sql: 'UPDATE study_sessions SET grammar_retention_policy_version = NULL WHERE id = ?',
      args: [id]
    });
    const plan = JSON.parse(
      String(
        (
          await client.execute({
            sql: 'SELECT assessment_plan FROM study_sessions WHERE id = ?',
            args: [id]
          })
        ).rows[0].assessment_plan
      )
    );
    for (const questionId of plan.questions as string[])
      await answer(id, questionId, 'es');
    expect(await assessmentResults(client, learner, id)).toMatchObject({
      grammarRetentionEnabled: false
    });
  });

  it('reuses a holdout from an abandoned correct answer that was never rated', async () => {
    await client.execute(
      "UPDATE questions SET holdout = 0 WHERE id = 'fr-a1-001@1:q1'"
    );
    const first = await start();
    const questionId = String(
      (await getAssessment(client, learner, first.id)).question?.id
    );
    await answer(first.id, questionId, 'es');

    const second = await start();
    expect((await getAssessment(client, learner, second.id)).question?.id).toBe(
      questionId
    );
  });

  it('keeps an assessment in its rating stage when its final answer is fallback-correct', async () => {
    const { id } = await start();
    const stored = await client.execute({
      sql: 'SELECT assessment_plan FROM study_sessions WHERE id = ?',
      args: [id]
    });
    const questionIds = JSON.parse(String(stored.rows[0].assessment_plan))
      .questions as string[];
    for (const questionId of questionIds.slice(0, -1))
      await answer(id, questionId, '', true);
    const lastQuestionId = questionIds[questionIds.length - 1];
    const recorded = await recordAttempt(
      client,
      learner,
      {
        studySessionId: id,
        questionId: lastQuestionId,
        submissionKey: randomUUID(),
        evidenceKind: 'independent',
        answer: 'Nous voici.'
      },
      {
        fallback: async () => ({
          outcome: 'correct' as const,
          reason: 'answered' as const,
          evaluated: true as const
        })
      }
    );

    expect((await getAssessment(client, learner, id)).state).toBe('active');
    const item = (await assessmentResults(client, learner, id)).items.find(
      (result) => result.attemptId === recorded.id
    );
    expect(item).toMatchObject({ outcome: 'correct', rating: null });
    await rateGrammarAttempt(client, learner, {
      attemptId: recorded.id,
      rating: 'good',
      expectedSessionId: id
    });
    expect((await getAssessment(client, learner, id)).state).toBe('completed');
    expect(
      (
        await client.execute({
          sql: 'SELECT rating FROM grammar_retention_events WHERE owner_id = ? AND study_session_id = ?',
          args: [learner.userId, id]
        })
      ).rows
    ).toEqual([{ rating: 'good' }]);
  });

  async function stoppedAssessment(stop: 'incorrect' | 'not-sure') {
    const { id } = await expandedAssessment('multiple-choice');
    const first = (await getAssessment(client, learner, id)).question!;
    const provisional = await answer(id, first.id);
    for (let i = 0; i < 5; i++) {
      const next = (await getAssessment(client, learner, id)).question!;
      await answer(
        id,
        next.id,
        stop === 'not-sure' ? '' : 'wrong',
        stop === 'not-sure'
      );
    }
    expect((await getAssessment(client, learner, id)).state).toBe('active');
    return { id, provisional };
  }

  it.each(['incorrect', 'not-sure'] as const)(
    'finalizes a stopped assessment after discarding its last unrated answer (%s)',
    async (stop) => {
      const { id, provisional } = await stoppedAssessment(stop);
      await discardUnratedAssessmentAnswer(client, learner, provisional.id, id);
      expect((await getAssessment(client, learner, id)).state).toBe(
        'completed'
      );
      expect(
        (
          await client.execute('SELECT id FROM attempts WHERE id = ?', [
            provisional.id
          ])
        ).rows
      ).toEqual([]);
      const evidence = await client.execute('SELECT * FROM skill_evidence');
      const events = await client.execute(
        'SELECT * FROM grammar_retention_events'
      );
      expect(evidence.rows).toHaveLength(stop === 'incorrect' ? 5 : 0);
      expect(events.rows).toHaveLength(stop === 'incorrect' ? 5 : 0);
    }
  );

  it('rolls back discard, completion and evidence when stopped-assessment retention fails', async () => {
    const { id, provisional } = await stoppedAssessment('incorrect');
    await client.execute(
      "CREATE TRIGGER reject_discard_review BEFORE INSERT ON grammar_retention_events BEGIN SELECT RAISE(ABORT, 'synthetic discard failure'); END"
    );
    await expect(
      discardUnratedAssessmentAnswer(client, learner, provisional.id, id)
    ).rejects.toThrow(/synthetic discard failure/);
    expect((await getAssessment(client, learner, id)).state).toBe('active');
    expect(
      (
        await client.execute('SELECT id FROM attempts WHERE id = ?', [
          provisional.id
        ])
      ).rows
    ).toHaveLength(1);
    for (const table of [
      'skill_evidence',
      'grammar_retention_events',
      'grammar_retention_schedules'
    ])
      expect((await client.execute(`SELECT * FROM ${table}`)).rows).toEqual([]);
    await client.execute('DROP TRIGGER reject_discard_review');
    await discardUnratedAssessmentAnswer(client, learner, provisional.id, id);
    expect((await getAssessment(client, learner, id)).state).toBe('completed');
    expect(
      (await client.execute('SELECT * FROM grammar_retention_events')).rows
    ).toHaveLength(5);
  });

  it('rolls back the last rating and assessment completion when retention persistence fails', async () => {
    const { id } = await start();
    const attempts = [];
    attempts.push(await answer(id, 'fr-a1-001@1:q2', 'es'));
    attempts.push(await answer(id, 'fr-a1-002@1:q1', 'On est ici.'));
    attempts.push(await answer(id, 'fr-a1-003@1:q1', 'es'));
    for (const attempt of attempts.slice(0, 2))
      await rateGrammarAttempt(client, learner, {
        attemptId: attempt.id,
        rating: 'good',
        expectedSessionId: id
      });
    await client.execute(
      "CREATE TRIGGER reject_assessment_review BEFORE INSERT ON grammar_retention_events BEGIN SELECT RAISE(ABORT, 'synthetic assessment failure'); END"
    );
    await expect(
      rateGrammarAttempt(client, learner, {
        attemptId: attempts[2].id,
        rating: 'good',
        expectedSessionId: id
      })
    ).rejects.toThrow(/synthetic assessment failure/);
    expect((await getAssessment(client, learner, id)).state).toBe('active');
    expect(
      (
        await client.execute(
          'SELECT grammar_rating FROM attempts WHERE id = ?',
          [attempts[2].id]
        )
      ).rows[0].grammar_rating
    ).toBeNull();
    expect(
      (await client.execute('SELECT * FROM grammar_retention_events')).rows
    ).toHaveLength(0);
    expect(
      (await client.execute('SELECT * FROM grammar_retention_schedules')).rows
    ).toHaveLength(0);
    await client.execute('DROP TRIGGER reject_assessment_review');
    await rateGrammarAttempt(client, learner, {
      attemptId: attempts[2].id,
      rating: 'good',
      expectedSessionId: id
    });
    expect((await getAssessment(client, learner, id)).state).toBe('completed');
    expect(
      (await client.execute('SELECT * FROM grammar_retention_events')).rows
    ).toHaveLength(3);
  });

  it('lets a learner rate a valid answer after a newer version is published', async () => {
    const { id } = await start();
    const stored = await client.execute({
      sql: 'SELECT assessment_plan FROM study_sessions WHERE id = ?',
      args: [id]
    });
    const questionIds = JSON.parse(String(stored.rows[0].assessment_plan))
      .questions as string[];
    const answers = new Map([
      ['fr-a1-001@1:q2', 'es'],
      ['fr-a1-002@1:q1', 'On est ici.'],
      ['fr-a1-003@1:q1', 'es']
    ]);
    const attempts = [];
    for (const questionId of questionIds)
      attempts.push(
        await answer(id, questionId, answers.get(questionId) ?? 'es')
      );
    await client.execute({
      sql: "INSERT INTO content_versions (id, skill_id, language, version, status) VALUES ('fr-a1-001@2', 'fr-a1-001', 'fr', 2, 'pilot-ready')"
    });
    await expect(
      rateGrammarAttempt(client, learner, {
        attemptId: attempts[0].id,
        rating: 'good',
        expectedSessionId: id
      })
    ).resolves.toMatchObject({ duplicate: false });
  });

  it('does not offer a holdout again when a later content version republishes the same item', async () => {
    const first = await start();
    await answer(first.id, 'fr-a1-001@1:q2', 'not an accepted response');
    const pkg = approvedPackage();
    const republished = structuredClone(pkg.versions[0]);
    republished.id = 'fr-a1-001@2';
    republished.version = 2;
    republished.questions = republished.questions.map((question) => ({
      ...question,
      id: question.id.replace('@1:', '@2:'),
      holdout: question.id.endsWith(':q2'),
      change: 'same' as const,
      continues: question.id
    }));
    pkg.curriculumVersion = '0.1.1';
    pkg.versions = [republished];
    await importContent(client, pkg);
    await expect(start()).rejects.toMatchObject({
      code: 'CONTENT_UNAVAILABLE'
    });
  });

  it('offers a holdout again when a later content version changes its meaning', async () => {
    const first = await start();
    await answer(first.id, 'fr-a1-001@1:q2', 'not an accepted response');
    const pkg = approvedPackage();
    const revised = structuredClone(pkg.versions[0]);
    revised.id = 'fr-a1-001@2';
    revised.version = 2;
    revised.questions = revised.questions.map((question) => ({
      ...question,
      id: question.id.replace('@1:', '@2:'),
      holdout: question.id.endsWith(':q2'),
      ...(question.id.endsWith(':q2')
        ? { change: 'changed' as const }
        : { change: 'same' as const, continues: question.id })
    }));
    pkg.curriculumVersion = '0.2.0';
    pkg.versions = [revised];
    await importContent(client, pkg);
    const second = await start();
    const plan = await client.execute({
      sql: 'SELECT assessment_plan FROM study_sessions WHERE id = ?',
      args: [second.id]
    });
    expect(String(plan.rows[0].assessment_plan)).toContain('fr-a1-001@2:q2');
  });

  it('plans from the newest version that is not quarantined', async () => {
    await client.execute(
      "INSERT INTO content_versions (id, skill_id, language, version, status) VALUES ('fr-a1-001@2', 'fr-a1-001', 'fr', 2, 'quarantined')"
    );
    const { id } = await start();
    const plan = await client.execute({
      sql: 'SELECT assessment_plan FROM study_sessions WHERE id = ?',
      args: [id]
    });
    expect(String(plan.rows[0].assessment_plan)).toContain('fr-a1-001@1:q2');
  });

  it('does not offer a holdout again when a retired skill carried its answer over', async () => {
    const first = await start();
    await answer(first.id, 'fr-a1-001@1:q2', 'not an accepted response');
    await client.execute(
      "UPDATE skills SET retired_at = 1, replaced_by = 'fr-a1-002', carry_progress = 1 WHERE id = 'fr-a1-001'"
    );
    await client.execute(
      "UPDATE questions SET lineage_key = 'q2' WHERE id = 'fr-a1-002@1:q1'"
    );
    await expect(start()).rejects.toMatchObject({
      code: 'CONTENT_UNAVAILABLE'
    });
  });

  it('offers a holdout another learner answered, since exposure is per learner', async () => {
    const other = testSession('learner-b');
    const theirs = await startAssessment(client, other, {
      language: 'fr',
      submissionKey: randomUUID()
    });
    await recordAttempt(client, other, {
      studySessionId: theirs.id,
      questionId: 'fr-a1-001@1:q2',
      submissionKey: randomUUID(),
      evidenceKind: 'independent',
      answer: 'es'
    });
    const { id } = await start();
    const plan = await client.execute({
      sql: 'SELECT assessment_plan FROM study_sessions WHERE id = ?',
      args: [id]
    });
    expect(String(plan.rows[0].assessment_plan)).toContain('fr-a1-001@1:q2');
  });

  it('rejects a planned item the learner already answered in another session', async () => {
    const first = await start();
    const second = await start();
    await answer(first.id, 'fr-a1-001@1:q2', 'not an accepted response');
    await expect(answer(second.id, 'fr-a1-001@1:q2')).rejects.toMatchObject({
      code: 'STALE_QUESTION'
    });
    expect(
      (
        await client.execute({
          sql: 'SELECT 1 FROM attempts WHERE study_session_id = ?',
          args: [second.id]
        })
      ).rows
    ).toHaveLength(0);
  });

  it('records assessment evidence only after completion and excludes uncertainty', async () => {
    const { id } = await start();
    await answer(id, 'fr-a1-001@1:q2', '', true);
    expect(
      (await client.execute('SELECT * FROM skill_evidence')).rows
    ).toHaveLength(0);
    const correct = await answer(id, 'fr-a1-002@1:q1', 'On est ici.');
    const alsoCorrect = await answer(id, 'fr-a1-003@1:q1', 'es');
    const results = await assessmentResults(client, learner, id);
    expect(results).toMatchObject({
      counts: { correct: 2, incorrect: 0, uncertain: 1 },
      foundationGaps: ['fr-a1-001']
    });
    expect(
      (
        await client.execute({
          sql: 'SELECT attempt_id, contribution FROM skill_evidence'
        })
      ).rows
    ).toEqual([]);
    await rateGrammarAttempt(client, learner, {
      attemptId: correct.id,
      rating: 'good',
      expectedSessionId: id
    });
    await rateGrammarAttempt(client, learner, {
      attemptId: alsoCorrect.id,
      rating: 'good',
      expectedSessionId: id
    });
    expect((await getAssessment(client, learner, id)).state).toBe('completed');
    expect(
      (
        await client.execute({
          sql: 'SELECT attempt_id, contribution FROM skill_evidence'
        })
      ).rows
    ).toEqual([
      { attempt_id: correct.id, contribution: 1 },
      { attempt_id: alsoCorrect.id, contribution: 1 }
    ]);
    expect(
      (await client.execute('SELECT * FROM card_drafts')).rows
    ).toHaveLength(0);
  });

  it('preserves a historical Decisions verdict in assessment result feedback', async () => {
    const { id } = await start();
    await answer(id, 'fr-a1-001@1:q2', '', true);
    const historical = await answer(id, 'fr-a1-002@1:q1', 'On est ici.');
    await answer(id, 'fr-a1-003@1:q1', 'es');
    await client.execute(
      "UPDATE evaluations SET outcome = 'uncertain' WHERE attempt_id = ?",
      [historical.id]
    );
    await client.execute({
      sql: 'INSERT INTO evaluations (id, owner_id, attempt_id, evaluator_version, rubric_version, outcome) VALUES (?, ?, ?, ?, ?, ?)',
      args: [
        'historical-decisions-evaluation',
        learner.userId,
        historical.id,
        'decisions-1',
        'fallback-rubric-1:fr-a1-002@1',
        'correct'
      ]
    });

    const results = await assessmentResults(client, learner, id);
    expect(
      results.items.find((item) => item.attemptId === historical.id)
    ).toMatchObject({ outcome: 'correct' });
    expect(results).toMatchObject({
      counts: { correct: 2, incorrect: 0, uncertain: 1 },
      foundationGaps: ['fr-a1-001']
    });
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
    await answer(id, 'fr-a1-003@1:q1', 'es');
    const results = await assessmentResults(client, learner, id);
    for (const item of results.items)
      await rateGrammarAttempt(client, learner, {
        attemptId: item.attemptId,
        rating: 'good',
        expectedSessionId: id
      });
    await expect(start()).rejects.toMatchObject({
      code: 'CONTENT_UNAVAILABLE'
    });
  });

  it('includes every skill across levels for an A1 enrollment without a sample cap', async () => {
    await client.execute(
      "INSERT INTO enrollments (id, owner_id, language, starting_level, explanation_language) VALUES ('en-a', 'learner-a', 'en', 'A1', 'en')"
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
      total: 16,
      coverage: { A1: 8, A2: 8 },
      question: { id: 'en-A1-0:q' }
    });
  });
});
