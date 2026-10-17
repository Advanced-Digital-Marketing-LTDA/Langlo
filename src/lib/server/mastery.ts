import { randomUUID } from 'node:crypto';
import type { Client, Row } from '@libsql/client';
import { beginWrite, type LearnerSession } from './flashcards';
import { feedbackEvaluation } from './assessment';
import { StudyError } from './study-error';

export const GRAMMAR_POLICY_VERSION = 'grammar-1';
export type GrammarStatus = 'unknown' | 'weak' | 'practising' | 'secure';

export function scoreGrammar({
  correct,
  incorrect,
  sessions
}: {
  correct: number;
  incorrect: number;
  sessions: number;
}) {
  const independentItems = correct + incorrect;
  let status: GrammarStatus = 'unknown';
  if (independentItems > 0) {
    const accuracy = correct / independentItems;
    status =
      accuracy < 0.6
        ? 'weak'
        : independentItems >= 5 && sessions >= 2 && accuracy >= 0.8
          ? 'secure'
          : 'practising';
  }
  const reasons: Record<GrammarStatus, string> = {
    unknown: 'No qualifying independent grammar evidence yet.',
    weak: 'Fewer than 60% of the qualifying items were correct; revisit this topic.',
    practising:
      'Keep practising distinct items across sessions to build stronger evidence.',
    secure:
      'At least five distinct items across two sessions, with at least 80% correct.'
  };
  return {
    status,
    correct,
    incorrect,
    sessions,
    independentItems,
    reason: reasons[status],
    policyVersion: GRAMMAR_POLICY_VERSION
  };
}

/** First response to a logical item wins, across sessions and content versions. */
export function qualifyingGrammarEvidence(rows: Row[]) {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const id = String(row.attempt_id);
    const existing = grouped.get(id);
    if (existing) existing.push(row);
    else grouped.set(id, [row]);
  }
  const attempts = [...grouped.values()].sort(
    (a, b) =>
      Number(a[0].created_at) - Number(b[0].created_at) ||
      Number(a[0].sequence) - Number(b[0].sequence) ||
      String(a[0].attempt_id).localeCompare(String(b[0].attempt_id))
  );
  const seen = new Set<string>();
  const qualified: {
    attemptId: string;
    evaluationId: string;
    skillId: string;
    sessionId: string;
    correct: boolean;
  }[] = [];
  for (const evaluations of attempts) {
    const row = evaluations[0];
    const prefix = `${row.content_version_id}:`;
    const question = String(row.question_id);
    const key = JSON.stringify([
      row.skill_id,
      question.startsWith(prefix) ? question.slice(prefix.length) : question
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    if (
      row.evidence_kind !== 'independent' ||
      row.not_sure ||
      row.status === 'quarantined' ||
      (row.mode === 'assessment' && row.state !== 'completed')
    )
      continue;
    const evaluation = feedbackEvaluation(
      evaluations,
      String(row.content_version_id)
    );
    if (
      !evaluation ||
      !['correct', 'incorrect'].includes(String(evaluation.outcome))
    )
      continue;
    qualified.push({
      attemptId: String(row.attempt_id),
      evaluationId: String(evaluation.evaluation_id),
      skillId: String(row.skill_id),
      sessionId: String(row.study_session_id),
      correct: evaluation.outcome === 'correct'
    });
  }
  return qualified;
}

/** Recompute from trusted history; the existing evidence ledger is idempotent. */
export async function getMastery(
  client: Client,
  learner: LearnerSession,
  language: string
) {
  const tx = await beginWrite(client);
  try {
    const enrolled = await tx.execute({
      sql: 'SELECT 1 FROM enrollments WHERE owner_id = ? AND language = ?',
      args: [learner.userId, language]
    });
    if (!enrolled.rows.length) throw new StudyError('NOT_FOUND');
    const catalog = await tx.execute({
      sql: `SELECT sk.id, sk.level, l.title AS lesson_title, COALESCE(l.title, sk.id) AS title, v.id AS content_version_id, v.status
        FROM skills sk LEFT JOIN content_versions v ON v.skill_id = sk.id AND v.version = (SELECT MAX(v2.version) FROM content_versions v2 WHERE v2.skill_id = sk.id)
        LEFT JOIN lessons l ON l.content_version_id = v.id WHERE sk.language = ? ORDER BY sk.level, sk.id`,
      args: [language]
    });
    const prerequisites = await tx.execute({
      sql: 'SELECT skill_id, prerequisite_id FROM prerequisites WHERE language = ? ORDER BY skill_id, prerequisite_id',
      args: [language]
    });
    const source = await tx.execute({
      sql: `SELECT a.id AS attempt_id, a.rowid AS sequence, a.created_at, a.question_id, a.content_version_id, a.skill_id, a.study_session_id, a.evidence_kind, a.not_sure,
        s.mode, s.state, v.status, e.id AS evaluation_id, e.evaluator_version, e.rubric_version, e.outcome
        FROM attempts a JOIN study_sessions s ON s.id = a.study_session_id AND s.owner_id = a.owner_id
        JOIN content_versions v ON v.id = a.content_version_id
        LEFT JOIN evaluations e ON e.attempt_id = a.id AND e.owner_id = a.owner_id
        WHERE a.owner_id = ? AND a.language = ? ORDER BY a.created_at, a.rowid, e.created_at, e.id`,
      args: [learner.userId, language]
    });
    const evidence = qualifyingGrammarEvidence(source.rows);
    for (const item of evidence) {
      await tx.execute({
        sql: 'INSERT INTO skill_evidence (id, owner_id, attempt_id, evaluation_id, skill_id, language, scoring_version, contribution) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id, attempt_id, scoring_version) DO NOTHING',
        args: [
          randomUUID(),
          learner.userId,
          item.attemptId,
          item.evaluationId,
          item.skillId,
          language,
          GRAMMAR_POLICY_VERSION,
          item.correct ? 1 : 0
        ]
      });
    }
    const result = catalog.rows.map((row) => {
      const items = evidence.filter((item) => item.skillId === row.id);
      return {
        skillId: String(row.id),
        level: String(row.level),
        title: String(row.title),
        contentVersionId:
          row.content_version_id === null
            ? null
            : String(row.content_version_id),
        available:
          row.content_version_id !== null &&
          row.lesson_title !== null &&
          row.status !== 'quarantined',
        prerequisites: prerequisites.rows
          .filter((edge) => edge.skill_id === row.id)
          .map((edge) => String(edge.prerequisite_id)),
        ...scoreGrammar({
          correct: items.filter((item) => item.correct).length,
          incorrect: items.filter((item) => !item.correct).length,
          sessions: new Set(items.map((item) => item.sessionId)).size
        })
      };
    });
    await tx.commit();
    return result;
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    throw error;
  } finally {
    tx.close();
  }
}
