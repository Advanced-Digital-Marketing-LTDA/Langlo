import { randomUUID } from 'node:crypto';
import type { Client, Row } from '@libsql/client';
import { beginWrite, type LearnerSession } from './flashcards';
import { feedbackEvaluation } from './assessment';
import { StudyError } from './study-error';
import { effectiveLineageKey } from './lineage';
import { span } from './tracing';

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

/**
 * What counts now. `keys` holds, per skill, the lineage keys of its current
 * version; an answer to a key outside it (a changed or removed question) stays
 * stored but no longer counts. `carry` maps a retired skill to the skill its
 * answers count for.
 */
export type CurrentContent = {
  keys: Map<string, Set<string>>;
  carry: Map<string, string>;
};

export function carriedTo(skillId: string, carry: Map<string, string>) {
  let target = skillId;
  let hops = 0;
  while (carry.has(target)) {
    if (hops > carry.size) throw new StudyError('NOT_FOUND');
    target = carry.get(target) as string;
    hops += 1;
  }
  return target;
}

/** Evaluation rows grouped per attempt, oldest attempt first. */
function attemptsInOrder(rows: Row[]) {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const id = String(row.attempt_id);
    const existing = grouped.get(id);
    if (existing) existing.push(row);
    else grouped.set(id, [row]);
  }
  return [...grouped.values()].sort(
    (a, b) =>
      Number(a[0].created_at) - Number(b[0].created_at) ||
      Number(a[0].sequence) - Number(b[0].sequence) ||
      String(a[0].attempt_id).localeCompare(String(b[0].attempt_id))
  );
}

/** Whether the attempt itself may count as independent grammar evidence. */
function isIndependentEvidence(row: Row) {
  return !(
    row.evidence_kind !== 'independent' ||
    row.not_sure ||
    row.status === 'quarantined' ||
    (row.mode === 'assessment' && row.state !== 'completed')
  );
}

/** First response to a logical item wins, across sessions and content versions. */
export function qualifyingGrammarEvidence(
  rows: Row[],
  current?: CurrentContent
) {
  const attempts = attemptsInOrder(rows);
  const seen = new Set<string>();
  const qualified: {
    attemptId: string;
    itemKey: string;
    contentVersionId: string;
    evaluationId: string;
    skillId: string;
    countsFor: string;
    sessionId: string;
    correct: boolean;
  }[] = [];
  for (const evaluations of attempts) {
    const row = evaluations[0];
    const itemKey = effectiveLineageKey({
      lineageKey: row.lineage_key == null ? null : String(row.lineage_key),
      contentVersionId: String(row.content_version_id),
      questionId: String(row.question_id)
    });
    const countsFor = current
      ? carriedTo(String(row.skill_id), current.carry)
      : String(row.skill_id);
    if (current && !current.keys.get(countsFor)?.has(itemKey)) continue;
    const key = JSON.stringify([countsFor, itemKey]);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!isIndependentEvidence(row)) continue;
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
      itemKey,
      contentVersionId: String(row.content_version_id),
      evaluationId: String(evaluation.evaluation_id),
      skillId: String(row.skill_id),
      countsFor,
      sessionId: String(row.study_session_id),
      correct: evaluation.outcome === 'correct'
    });
  }
  return qualified;
}

/**
 * The lineage keys each skill's current version holds (its newest version that
 * is not quarantined), and which retired skills carry their answers over.
 */
export async function currentContent(
  tx: Pick<Client, 'execute'>,
  language: string
): Promise<CurrentContent> {
  const questions = await tx.execute({
    sql: `SELECT q.skill_id, q.id, q.content_version_id, q.lineage_key
      FROM questions q JOIN content_versions v ON v.id = q.content_version_id
      WHERE q.language = ? AND v.status <> 'quarantined'
        AND v.version = (SELECT MAX(v2.version) FROM content_versions v2 WHERE v2.skill_id = q.skill_id AND v2.status <> 'quarantined')`,
    args: [language]
  });
  const keys = new Map<string, Set<string>>();
  for (const row of questions.rows) {
    const skill = String(row.skill_id);
    const set = keys.get(skill) ?? new Set<string>();
    set.add(
      effectiveLineageKey({
        lineageKey: row.lineage_key === null ? null : String(row.lineage_key),
        contentVersionId: String(row.content_version_id),
        questionId: String(row.id)
      })
    );
    keys.set(skill, set);
  }
  const retired = await tx.execute({
    sql: 'SELECT id, replaced_by FROM skills WHERE language = ? AND retired_at IS NOT NULL AND carry_progress = 1 AND replaced_by IS NOT NULL',
    args: [language]
  });
  return {
    keys,
    carry: new Map(
      retired.rows.map((r) => [String(r.id), String(r.replaced_by)])
    )
  };
}

/** The stored attempts and evaluations the evidence rules read, oldest first. */
export async function loadEvidenceRows(
  tx: Pick<Client, 'execute'>,
  filter: { ownerId?: string; language?: string; skillId?: string }
) {
  const clauses: string[] = [];
  const args: string[] = [];
  if (filter.ownerId !== undefined) {
    clauses.push('a.owner_id = ?');
    args.push(filter.ownerId);
  }
  if (filter.language !== undefined) {
    clauses.push('a.language = ?');
    args.push(filter.language);
  }
  if (filter.skillId !== undefined) {
    clauses.push('a.skill_id = ?');
    args.push(filter.skillId);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await tx.execute({
    sql: `SELECT a.id AS attempt_id, a.owner_id, a.rowid AS sequence, a.created_at, a.question_id, a.content_version_id, a.skill_id, a.study_session_id, a.evidence_kind, a.not_sure,
        s.mode, s.state, v.status, aq.lineage_key, e.id AS evaluation_id, e.evaluator_version, e.rubric_version, e.outcome
        FROM attempts a JOIN study_sessions s ON s.id = a.study_session_id AND s.owner_id = a.owner_id
        JOIN content_versions v ON v.id = a.content_version_id
        LEFT JOIN questions aq ON aq.id = a.question_id
        LEFT JOIN evaluations e ON e.attempt_id = a.id AND e.owner_id = a.owner_id
        ${where} ORDER BY a.created_at, a.rowid, e.created_at, e.id`,
    args
  });
  return result.rows;
}

type Tx = Pick<Client, 'execute'>;
type Evidence = ReturnType<typeof qualifyingGrammarEvidence>;

async function loadCatalog(tx: Tx, language: string) {
  const catalog = await tx.execute({
    sql: `SELECT sk.id, sk.level, l.title AS lesson_title, COALESCE(l.title, sk.id) AS title, v.id AS content_version_id, v.status
        FROM skills sk LEFT JOIN content_versions v ON v.skill_id = sk.id AND v.id = (SELECT v2.id FROM content_versions v2 WHERE v2.skill_id = sk.id ORDER BY v2.status = 'quarantined', v2.version DESC LIMIT 1)
        LEFT JOIN lessons l ON l.content_version_id = v.id WHERE sk.language = ? AND sk.retired_at IS NULL ORDER BY sk.level, sk.id`,
    args: [language]
  });
  return catalog.rows;
}

async function loadPrerequisites(tx: Tx, language: string) {
  const prerequisites = await tx.execute({
    sql: 'SELECT p.skill_id, p.prerequisite_id FROM prerequisites p JOIN skills r ON r.id = p.prerequisite_id WHERE p.language = ? AND r.retired_at IS NULL ORDER BY p.skill_id, p.prerequisite_id',
    args: [language]
  });
  return prerequisites.rows;
}

/** Write the qualifying evidence to the ledger; replays change nothing. */
async function recordEvidence(
  tx: Tx,
  ownerId: string,
  language: string,
  evidence: Evidence
) {
  for (const item of evidence)
    await tx.execute({
      sql: 'INSERT INTO skill_evidence (id, owner_id, attempt_id, evaluation_id, skill_id, language, scoring_version, contribution) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id, attempt_id, scoring_version) DO NOTHING',
      args: [
        randomUUID(),
        ownerId,
        item.attemptId,
        item.evaluationId,
        item.skillId,
        language,
        GRAMMAR_POLICY_VERSION,
        item.correct ? 1 : 0
      ]
    });
}

/** One catalog row with its prerequisites and the status its evidence earns. */
function skillStanding(row: Row, evidence: Evidence, prerequisites: Row[]) {
  const items = evidence.filter((item) => item.countsFor === row.id);
  return {
    skillId: String(row.id),
    level: String(row.level),
    title: String(row.title),
    contentVersionId:
      row.content_version_id === null ? null : String(row.content_version_id),
    available:
      row.content_version_id !== null &&
      row.lesson_title !== null &&
      row.status !== 'quarantined',
    prerequisites: prerequisites
      .filter((edge) => edge.skill_id === row.id)
      .map((edge) => String(edge.prerequisite_id)),
    ...scoreGrammar({
      correct: items.filter((item) => item.correct).length,
      incorrect: items.filter((item) => !item.correct).length,
      sessions: new Set(items.map((item) => item.sessionId)).size
    })
  };
}

/** Recompute from trusted history; the existing evidence ledger is idempotent. */
export async function getMastery(
  client: Client,
  learner: LearnerSession,
  language: string
) {
  const tx = await span('mastery.begin-write', () => beginWrite(client));
  try {
    const enrolled = await span('mastery.enrollment-check', () =>
      tx.execute({
        sql: 'SELECT 1 FROM enrollments WHERE owner_id = ? AND language = ?',
        args: [learner.userId, language]
      })
    );
    if (!enrolled.rows.length) throw new StudyError('NOT_FOUND');
    const catalog = await span('mastery.catalog', () =>
      loadCatalog(tx, language)
    );
    const prerequisites = await span('mastery.prerequisites', () =>
      loadPrerequisites(tx, language)
    );
    const source = await span('mastery.load-evidence', async (active) => {
      const rows = await loadEvidenceRows(tx, {
        ownerId: learner.userId,
        language
      });
      active.setAttribute('rows', rows.length);
      return rows;
    });
    const evidence = qualifyingGrammarEvidence(
      source,
      await span('mastery.current-content', () => currentContent(tx, language))
    );
    await span(
      'mastery.record-evidence',
      () => recordEvidence(tx, learner.userId, language, evidence),
      { rows: evidence.length }
    );
    const result = catalog.map((row) =>
      skillStanding(row, evidence, prerequisites)
    );
    await span('mastery.commit', () => tx.commit());
    return result;
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    throw error;
  } finally {
    tx.close();
  }
}
