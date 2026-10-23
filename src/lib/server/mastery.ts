import { randomUUID } from 'node:crypto';
import type { Client, InStatement, Row, Transaction } from '@libsql/client';
import { beginRead, type LearnerSession } from './flashcards';
import { feedbackEvaluation } from './assessment';
import { StudyError } from './study-error';
import { effectiveLineageKey } from './lineage';
import { span } from './tracing';
import { GRAMMAR_RETENTION_POLICY_VERSION } from './grammar-retention';

export const GRAMMAR_POLICY_VERSION = 'grammar-2';
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

function unratedCorrectEvidence(row: Row, outcome: unknown) {
  return (
    row.grammar_retention_policy_version === GRAMMAR_RETENTION_POLICY_VERSION &&
    outcome === 'correct' &&
    row.grammar_rating == null
  );
}

function grammarEvidenceCandidate(
  evaluations: Row[],
  current?: CurrentContent
) {
  const row = evaluations[0];
  const itemKey = effectiveLineageKey({
    lineageKey: row.lineage_key == null ? null : String(row.lineage_key),
    contentVersionId: String(row.content_version_id),
    questionId: String(row.question_id)
  });
  const countsFor = current
    ? carriedTo(String(row.skill_id), current.carry)
    : String(row.skill_id);
  if (current && !current.keys.get(countsFor)?.has(itemKey)) return null;
  const evaluation = feedbackEvaluation(
    evaluations,
    String(row.content_version_id)
  );
  if (unratedCorrectEvidence(row, evaluation?.outcome)) return null;
  return { row, itemKey, countsFor, evaluation };
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
    const candidate = grammarEvidenceCandidate(evaluations, current);
    if (!candidate) continue;
    const { row, itemKey, countsFor, evaluation } = candidate;
    const key = JSON.stringify([countsFor, itemKey]);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!isIndependentEvidence(row)) continue;
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
/** The two reads `currentContent` is built from, so a caller can batch them. */
function currentContentStatements(language: string): InStatement[] {
  return [
    {
      sql: `SELECT q.skill_id, q.id, q.content_version_id, q.lineage_key
      FROM questions q JOIN content_versions v ON v.id = q.content_version_id
      WHERE q.language = ? AND v.status <> 'quarantined'
        AND v.version = (SELECT MAX(v2.version) FROM content_versions v2 WHERE v2.skill_id = q.skill_id AND v2.status <> 'quarantined')`,
      args: [language]
    },
    {
      sql: 'SELECT id, replaced_by FROM skills WHERE language = ? AND retired_at IS NOT NULL AND carry_progress = 1 AND replaced_by IS NOT NULL',
      args: [language]
    }
  ];
}

function currentContentOf(questions: Row[], retired: Row[]): CurrentContent {
  const keys = new Map<string, Set<string>>();
  for (const row of questions) {
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
  return {
    keys,
    carry: new Map(retired.map((r) => [String(r.id), String(r.replaced_by)]))
  };
}

export async function currentContent(
  tx: Pick<Client, 'execute'>,
  language: string
): Promise<CurrentContent> {
  const [questions, retired] = currentContentStatements(language);
  return currentContentOf(
    (await tx.execute(questions)).rows,
    (await tx.execute(retired)).rows
  );
}

type EvidenceFilter = {
  ownerId?: string;
  language?: string;
  skillId?: string;
  attemptIds?: string[];
  studySessionId?: string;
  lineageKeys?: string[];
};

function evidenceWhere(filter: EvidenceFilter) {
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
  if (filter.attemptIds !== undefined) {
    clauses.push(`a.id IN (${filter.attemptIds.map(() => '?').join(', ')})`);
    args.push(...filter.attemptIds);
  }
  if (filter.studySessionId !== undefined) {
    clauses.push('a.study_session_id = ?');
    args.push(filter.studySessionId);
  }
  if (filter.lineageKeys !== undefined) {
    const placeholders = filter.lineageKeys.map(() => '?').join(', ');
    const legacyKey = `CASE WHEN substr(a.question_id, 1, length(a.content_version_id) + 1) = a.content_version_id || ':' THEN substr(a.question_id, length(a.content_version_id) + 2) ELSE a.question_id END`;
    clauses.push(
      `(aq.lineage_key IN (${placeholders}) OR (aq.lineage_key IS NULL AND ${legacyKey} IN (${placeholders})))`
    );
    args.push(...filter.lineageKeys, ...filter.lineageKeys);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return { where, args };
}

/** The stored attempts and evaluations the evidence rules read, oldest first. */
function evidenceRowsStatement(filter: EvidenceFilter): InStatement {
  const { where, args } = evidenceWhere(filter);
  return {
    sql: `SELECT a.id AS attempt_id, a.owner_id, a.rowid AS sequence, a.created_at, a.question_id, a.content_version_id, a.skill_id, a.study_session_id, a.evidence_kind, a.not_sure, a.grammar_rating,
        s.mode, s.state, s.grammar_retention_policy_version, v.status, aq.lineage_key, e.id AS evaluation_id, e.evaluator_version, e.rubric_version, e.outcome
        FROM attempts a JOIN study_sessions s ON s.id = a.study_session_id AND s.owner_id = a.owner_id
        JOIN content_versions v ON v.id = a.content_version_id
        LEFT JOIN questions aq ON aq.id = a.question_id
        LEFT JOIN evaluations e ON e.attempt_id = a.id AND e.owner_id = a.owner_id
        ${where} ORDER BY a.created_at, a.rowid, e.created_at, e.id`,
    args
  };
}

export async function loadEvidenceRows(
  tx: Pick<Client, 'execute'>,
  filter: EvidenceFilter
) {
  if (filter.attemptIds?.length === 0 || filter.lineageKeys?.length === 0)
    return [];
  const result = await tx.execute(evidenceRowsStatement(filter));
  return result.rows;
}

type Tx = Pick<Client, 'execute'>;
type LedgerTx = Pick<Transaction, 'execute' | 'batch'>;
type Evidence = ReturnType<typeof qualifyingGrammarEvidence>;
type EvidenceScope = { ownerId: string; language: string };
type PracticeCount = {
  sessions: Set<string>;
  answers: number;
  lastPractisedAt: number | null;
};
type PracticeCounts = Map<string, PracticeCount>;

function catalogStatement(language: string): InStatement {
  return {
    sql: `SELECT sk.id, sk.level, l.title AS lesson_title, COALESCE(l.title, sk.id) AS title, v.id AS content_version_id, v.status
        FROM skills sk LEFT JOIN content_versions v ON v.skill_id = sk.id AND v.id = (SELECT v2.id FROM content_versions v2 WHERE v2.skill_id = sk.id ORDER BY v2.status = 'quarantined', v2.version DESC LIMIT 1)
        LEFT JOIN lessons l ON l.content_version_id = v.id WHERE sk.language = ? AND sk.retired_at IS NULL ORDER BY sk.level, sk.id`,
    args: [language]
  };
}

function prerequisitesStatement(language: string): InStatement {
  return {
    sql: 'SELECT p.skill_id, p.prerequisite_id FROM prerequisites p JOIN skills r ON r.id = p.prerequisite_id WHERE p.language = ? AND r.retired_at IS NULL ORDER BY p.skill_id, p.prerequisite_id',
    args: [language]
  };
}

export type SkillCatalogEntry = {
  skillId: string;
  level: string;
  title: string;
  contentVersionId: string | null;
  available: boolean;
  prerequisites: string[];
};

/** Write the qualifying evidence to the ledger; replays change nothing. */
async function recordEvidence(
  tx: Tx,
  scope: EvidenceScope,
  evidence: Evidence
) {
  for (const item of evidence)
    await tx.execute({
      sql: 'INSERT INTO skill_evidence (id, owner_id, attempt_id, evaluation_id, skill_id, language, scoring_version, contribution) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id, attempt_id, scoring_version) DO NOTHING',
      args: [
        randomUUID(),
        scope.ownerId,
        item.attemptId,
        item.evaluationId,
        item.skillId,
        scope.language,
        GRAMMAR_POLICY_VERSION,
        item.correct ? 1 : 0
      ]
    });
}

function countPracticeAnswers(rows: Row[], carry: Map<string, string>) {
  const attempts = new Map(
    rows
      .filter((row) => row.mode === 'practice')
      .map((row) => [String(row.attempt_id), row])
  );
  const counts: PracticeCounts = new Map();
  for (const row of attempts.values()) {
    const skillId = carriedTo(String(row.skill_id), carry);
    const count = counts.get(skillId) ?? {
      sessions: new Set<string>(),
      answers: 0,
      lastPractisedAt: null
    };
    const createdAt = Number(row.created_at);
    count.sessions.add(String(row.study_session_id));
    count.answers += 1;
    count.lastPractisedAt = Math.max(
      count.lastPractisedAt ?? createdAt,
      createdAt
    );
    counts.set(skillId, count);
  }
  return counts;
}

/** Sync trusted answer history inside the write transaction that records it. */
export async function syncEvidenceLedger(
  tx: LedgerTx,
  scope: EvidenceScope & { attemptIds?: string[]; studySessionId?: string }
) {
  const seeds = await loadEvidenceRows(tx, scope);
  if (seeds.length === 0) return;
  await syncLineageEvidence(tx, scope, seedLineageKeys(seeds));
}

/** The lineages of the given attempt rows, each once. */
export function seedLineageKeys(seeds: Row[]) {
  return [
    ...new Set(
      seeds.map((row) =>
        effectiveLineageKey({
          lineageKey: row.lineage_key === null ? null : String(row.lineage_key),
          contentVersionId: String(row.content_version_id),
          questionId: String(row.question_id)
        })
      )
    )
  ];
}

/**
 * Sync the ledger for the history of the given lineages. The history and the
 * current content are independent reads, so they share one round trip.
 */
export async function syncLineageEvidence(
  tx: LedgerTx,
  scope: EvidenceScope,
  lineageKeys: string[]
) {
  const { ownerId, language } = scope;
  if (lineageKeys.length === 0) return;
  const [history, questions, retired] = await tx.batch([
    evidenceRowsStatement({ ownerId, language, lineageKeys }),
    ...currentContentStatements(language)
  ]);
  const evidence = qualifyingGrammarEvidence(
    history.rows,
    currentContentOf(questions.rows, retired.rows)
  );
  await span(
    'mastery.sync-evidence',
    () => recordEvidence(tx, scope, evidence),
    { rows: evidence.length }
  );
}

/** One catalog row before progress evidence is loaded. */
function skillCatalogEntry(row: Row, prerequisites: Row[]): SkillCatalogEntry {
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
      .map((edge) => String(edge.prerequisite_id))
  };
}

/** One catalog row with the status its evidence earns. */
function skillStanding(
  row: Row,
  evidence: Evidence,
  prerequisites: Row[],
  practiceCounts: PracticeCounts
) {
  const items = evidence.filter((item) => item.countsFor === row.id);
  const practice = practiceCounts.get(String(row.id));
  return {
    ...skillCatalogEntry(row, prerequisites),
    practisedSessions: practice?.sessions.size ?? 0,
    answers: practice?.answers ?? 0,
    lastPractisedAt: practice?.lastPractisedAt ?? null,
    ...scoreGrammar({
      correct: items.filter((item) => item.correct).length,
      incorrect: items.filter((item) => !item.correct).length,
      sessions: new Set(items.map((item) => item.sessionId)).size
    })
  };
}

/**
 * The five reads a track's mastery is computed from: the catalog, its
 * prerequisites, the learner's answer history and the current content.
 */
function masteryStatements(
  learner: LearnerSession,
  language: string
): InStatement[] {
  return [
    catalogStatement(language),
    prerequisitesStatement(language),
    evidenceRowsStatement({ ownerId: learner.userId, language }),
    ...currentContentStatements(language)
  ];
}

/** Where the answer history sits among `masteryStatements`. */
const EVIDENCE_STATEMENT = 2;

/** How many answer history rows the tracks' batched reads returned. */
function evidenceRowCount(
  tracks: { mastery: InStatement[]; extra: InStatement[] }[],
  read: Row[][]
) {
  let start = 0;
  let rows = 0;
  for (const track of tracks) {
    rows += read[start + EVIDENCE_STATEMENT].length;
    start += track.mastery.length + track.extra.length;
  }
  return rows;
}

/** Compute mastery from trusted answer history without changing learner state. */
function masteryOf([
  catalog,
  prerequisites,
  source,
  questions,
  retired
]: Row[][]) {
  const current = currentContentOf(questions, retired);
  const evidence = qualifyingGrammarEvidence(source, current);
  const practiceCounts = countPracticeAnswers(source, current.carry);
  return catalog.map((row) =>
    skillStanding(row, evidence, prerequisites, practiceCounts)
  );
}

/** Load the public topic catalog for a learner's enrolled track. */
export async function loadEnrolledCatalog(
  client: Client,
  learner: LearnerSession,
  language: string
) {
  const tx = await beginRead(client);
  try {
    const enrolled = await tx.execute({
      sql: 'SELECT starting_level FROM enrollments WHERE owner_id = ? AND language = ?',
      args: [learner.userId, language]
    });
    const enrollment = enrolled.rows[0];
    if (!enrollment) throw new StudyError('NOT_FOUND');
    const catalog = (await tx.execute(catalogStatement(language))).rows;
    const prerequisites = (await tx.execute(prerequisitesStatement(language)))
      .rows;
    const result = {
      language,
      level: String(enrollment.starting_level),
      skills: catalog.map((row) => skillCatalogEntry(row, prerequisites))
    };
    await tx.commit();
    return result;
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    throw error;
  } finally {
    tx.close();
  }
}

/** Reads a caller adds to each track's mastery reads, and how it reads their rows. */
export type Alongside<T> = {
  statements: (language: string) => InStatement[];
  read: (rows: Row[][]) => T;
};

const nothingAlongside: Alongside<null> = {
  statements: () => [],
  read: () => null
};

/**
 * Read mastery only for languages this learner is enrolled in, together with
 * the caller's own reads for each track. After the enrollments, every track's
 * reads go in one batch, so the number of round trips does not grow with the
 * number of tracks.
 */
export async function loadEnrolledMasteryWith<T>(
  client: Client,
  learner: LearnerSession,
  language: string | null,
  alongside: Alongside<T>
) {
  const tx = await beginRead(client);
  try {
    const enrolled = await tx.execute({
      sql: 'SELECT language, starting_level FROM enrollments WHERE owner_id = ? ORDER BY language',
      args: [learner.userId]
    });
    if (
      language !== null &&
      !enrolled.rows.some((row) => row.language === language)
    )
      throw new StudyError('NOT_FOUND');

    const tracks = enrolled.rows
      .filter((row) => language === null || row.language === language)
      .map((row) => {
        const trackLanguage = String(row.language);
        return {
          language: trackLanguage,
          level: String(row.starting_level),
          mastery: masteryStatements(learner, trackLanguage),
          extra: alongside.statements(trackLanguage)
        };
      });
    const statements = tracks.flatMap((track) => [
      ...track.mastery,
      ...track.extra
    ]);
    const results =
      statements.length === 0
        ? []
        : await span('mastery.reads', async (active) => {
            const read = (await tx.batch(statements)).map(
              (result) => result.rows
            );
            active.setAttribute('statements', statements.length);
            active.setAttribute('rows', evidenceRowCount(tracks, read));
            return read;
          });
    let offset = 0;
    const loaded = tracks.map((track) => {
      const mastery = results.slice(offset, offset + track.mastery.length);
      offset += track.mastery.length;
      const extra = results.slice(offset, offset + track.extra.length);
      offset += track.extra.length;
      return {
        language: track.language,
        level: track.level,
        skills: masteryOf(mastery),
        alongside: alongside.read(extra)
      };
    });
    await tx.commit();
    return loaded;
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    throw error;
  } finally {
    tx.close();
  }
}

/** Read mastery only for languages this learner is enrolled in. */
export async function loadEnrolledMastery(
  client: Client,
  learner: LearnerSession,
  language: string | null = null
) {
  const tracks = await loadEnrolledMasteryWith(
    client,
    learner,
    language,
    nothingAlongside
  );
  return tracks.map(({ language, level, skills }) => ({
    language,
    level,
    skills
  }));
}
