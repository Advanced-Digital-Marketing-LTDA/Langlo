import { randomUUID } from 'node:crypto';
import type { Client, InStatement, Row } from '@libsql/client';
import {
  getStudySchedule,
  scheduleStudyReview,
  studyScheduleOf,
  studyScheduleStatement,
  studyRetrievability,
  type LearnerSession
} from './flashcards';
import { feedbackEvaluation } from './assessment';
import { effectiveLineageKey } from './lineage';

export const GRAMMAR_RETENTION_POLICY_VERSION = 'grammar-fsrs-1';

export type GrammarRating = 'again' | 'hard' | 'good' | 'easy';
export type GrammarOutcome = 'correct' | 'incorrect' | 'uncertain';
export type GrammarReviewCandidate = {
  skillId: string;
  outcome: GrammarOutcome;
  evidenceKind: 'independent' | 'assisted';
  receivedHelp: boolean;
  notSure: boolean;
  available: boolean;
  rating: GrammarRating | null;
};

export type GrammarRetention = {
  state: 'not-assessed' | 'scheduled' | 'due' | 'overdue' | 'below-target';
  dueAt: number | null;
  lastReviewedAt: number | null;
  retrievability: number | null;
  target: number;
};

const ratingOrder: GrammarRating[] = ['again', 'hard', 'good', 'easy'];

function qualifyingRating(
  candidate: GrammarReviewCandidate
): GrammarRating | null {
  if (!candidate.available) return null;
  if (candidate.receivedHelp) return null;
  if (candidate.notSure) return null;
  if (candidate.outcome === 'incorrect') return 'again';
  return candidate.outcome === 'correct' ? candidate.rating : null;
}

function lowestRating(first: GrammarRating, second: GrammarRating) {
  return ratingOrder.indexOf(first) < ratingOrder.indexOf(second)
    ? first
    : second;
}

/** One completed session contributes at most its lowest qualifying rating per skill. */
export function aggregateGrammarRatings(
  candidates: GrammarReviewCandidate[]
): Map<string, GrammarRating> {
  const result = new Map<string, GrammarRating>();
  for (const candidate of candidates) {
    const rating = qualifyingRating(candidate);
    if (!rating) continue;
    const prior = result.get(candidate.skillId);
    result.set(candidate.skillId, lowestRating(prior ?? rating, rating));
  }
  return result;
}

function currentSkillsStatement(language: string): InStatement {
  return {
    sql: `SELECT sk.id AS skill_id, v.id AS content_version_id,
        COALESCE(l.title, sk.id) AS title, v.status AS content_status,
        l.content_version_id IS NOT NULL AS has_lesson,
        EXISTS (SELECT 1 FROM questions q WHERE q.content_version_id = v.id
          AND q.holdout = 0 AND q.prompt IS NOT NULL AND q.answer IS NOT NULL) AS has_question
      FROM skills sk
      LEFT JOIN content_versions v ON v.id = (
        SELECT v2.id FROM content_versions v2
        WHERE v2.skill_id = sk.id AND v2.language = sk.language
          AND v2.status IN ('schema-validated', 'pilot-ready')
        ORDER BY v2.version DESC LIMIT 1
      )
      LEFT JOIN lessons l ON l.content_version_id = v.id
      WHERE sk.language = ? AND sk.retired_at IS NULL
      ORDER BY sk.level, sk.id`,
    args: [language]
  };
}

function retentionState(
  dueAt: number,
  now: number,
  recall: number | null,
  target: number
): GrammarRetention['state'] {
  if (dueAt === now) return 'due';
  if (dueAt < now) return 'overdue';
  if (recall !== null && recall < target) return 'below-target';
  return 'scheduled';
}

function availableGrammarSkill(skill: Row) {
  const currentVersion = skill.content_version_id;
  return (
    currentVersion !== null &&
    skill.content_status !== null &&
    Boolean(skill.has_lesson) &&
    Boolean(skill.has_question)
  );
}

function retentionForSkill(
  skill: Row,
  row: Row | undefined,
  target: number,
  now: number
) {
  const available = availableGrammarSkill(skill);
  if (!row || !available)
    return {
      skillId: String(skill.skill_id),
      title: String(skill.title),
      available,
      retention: {
        state: 'not-assessed' as const,
        dueAt: null,
        lastReviewedAt: null,
        retrievability: null,
        target
      }
    };
  // A schedule keeps its recall state across content versions.
  const retrievability = studyRetrievability(
    {
      stateJson: String(row.state_json),
      schedulerVersion: String(row.scheduler_version),
      parametersJson: String(row.parameters_json)
    },
    new Date(now)
  );
  const dueAt = Number(row.due_at);
  const state = retentionState(dueAt, now, retrievability, target);
  return {
    skillId: String(skill.skill_id),
    title: String(skill.title),
    available,
    retention: {
      state,
      dueAt,
      lastReviewedAt:
        row.last_reviewed_at === null ? null : Number(row.last_reviewed_at),
      retrievability,
      target
    }
  };
}

type SkillRetention = {
  skillId: string;
  title: string;
  available: boolean;
  retention: GrammarRetention;
};

/**
 * The three reads `grammarRetentionFor` is built from, so a caller can batch
 * them: the study schedule, the current skills and the stored schedules.
 */
export function grammarRetentionStatements(
  learner: LearnerSession,
  language: string
): InStatement[] {
  return [
    studyScheduleStatement(learner.userId),
    currentSkillsStatement(language),
    {
      sql: `SELECT g.skill_id, g.content_version_id, g.state_json, g.due_at,
          g.reset_required, g.scheduler_version, g.parameters_json,
          (SELECT MAX(e.reviewed_at) FROM grammar_retention_events e
            WHERE e.owner_id = g.owner_id AND e.language = g.language AND e.skill_id = g.skill_id) AS last_reviewed_at
        FROM grammar_retention_schedules g WHERE g.owner_id = ? AND g.language = ?`,
      args: [learner.userId, language]
    }
  ];
}

export function grammarRetentionOf(
  [schedule, skills, stored]: Row[][],
  now: number
): SkillRetention[] {
  const schedules = new Map(stored.map((row) => [String(row.skill_id), row]));
  const target = studyScheduleOf(schedule).desiredRetention / 100;
  return skills.map((skill) =>
    retentionForSkill(skill, schedules.get(String(skill.skill_id)), target, now)
  );
}

/** Separate recall estimates from grammar mastery; no schedule means not assessed. */
export async function grammarRetentionFor(
  client: Pick<Client, 'execute'>,
  learner: LearnerSession,
  language: string,
  now = Date.now()
): Promise<SkillRetention[]> {
  const results = await Promise.all(
    grammarRetentionStatements(learner, language).map((statement) =>
      client.execute(statement)
    )
  );
  return grammarRetentionOf(
    results.map((result) => result.rows),
    now
  );
}

/** Every due skill of a track, oldest due first. */
export async function allDueGrammarReviews(
  client: Pick<Client, 'execute'>,
  learner: LearnerSession,
  language: string,
  now = Date.now()
) {
  return (await grammarRetentionFor(client, learner, language, now))
    .filter(
      (skill) =>
        skill.available && ['due', 'overdue'].includes(skill.retention.state)
    )
    .sort(
      (a, b) =>
        (a.retention.dueAt ?? now) - (b.retention.dueAt ?? now) ||
        a.skillId.localeCompare(b.skillId)
    )
    .map(({ skillId, title, retention }) => ({
      skillId,
      title,
      dueAt: retention.dueAt
    }));
}

/** The bounded, manually selectable set of due skills for a track. */
export async function dueGrammarReviews(
  client: Pick<Client, 'execute'>,
  learner: LearnerSession,
  language: string,
  now = Date.now()
) {
  return (await allDueGrammarReviews(client, learner, language, now)).slice(
    0,
    5
  );
}

/**
 * Every available grammar skill of a track that falls due before the study
 * day (`start` to `end`) ends: overdue ones fell due before it started,
 * today's ones since.
 * `ready` marks the skills a review session can include now.
 */
export async function grammarDueToday(
  client: Pick<Client, 'execute'>,
  learner: LearnerSession,
  language: string,
  { start, end, now }: { start: number; end: number; now: number }
) {
  const due = (await grammarRetentionFor(client, learner, language, now))
    .filter(
      (skill): skill is SkillRetention & { retention: { dueAt: number } } =>
        skill.available &&
        skill.retention.dueAt !== null &&
        skill.retention.dueAt < end
    )
    .sort(
      (a, b) =>
        a.retention.dueAt - b.retention.dueAt ||
        a.skillId.localeCompare(b.skillId)
    )
    .map(({ skillId, title, retention }) => ({
      skillId,
      title,
      dueAt: retention.dueAt,
      ready: retention.dueAt <= now
    }));
  return {
    overdue: due.filter((skill) => skill.dueAt < start),
    today: due.filter((skill) => skill.dueAt >= start)
  };
}

/** How many topics of a track have a saved review within the study day. */
export async function grammarReviewedToday(
  client: Pick<Client, 'execute'>,
  learner: LearnerSession,
  language: string,
  { start, end }: { start: number; end: number }
) {
  const result = await client.execute({
    sql: `SELECT COUNT(DISTINCT skill_id) AS reviewed FROM grammar_retention_events
      WHERE owner_id = ? AND language = ? AND reviewed_at >= ? AND reviewed_at < ?`,
    args: [learner.userId, language, start, end]
  });
  return Number(result.rows[0]?.reviewed ?? 0);
}

function groupedAttempts(rows: Row[]) {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const id = String(row.attempt_id);
    const group = grouped.get(id);
    if (group) group.push(row);
    else grouped.set(id, [row]);
  }
  return [...grouped.values()];
}

async function grammarCandidates(
  tx: Pick<Client, 'execute'>,
  learner: LearnerSession,
  studySessionId: string
) {
  const result = await tx.execute({
    sql: `SELECT a.id AS attempt_id, a.owner_id, a.skill_id, a.language,
        a.question_id, a.content_version_id, a.evidence_kind, a.received_help,
        a.not_sure, a.grammar_rating, a.created_at, q.lineage_key,
        (SELECT v2.id FROM content_versions v2 WHERE v2.skill_id = a.skill_id AND v2.language = a.language
          AND v2.status IN ('schema-validated', 'pilot-ready') ORDER BY v2.version DESC LIMIT 1) AS current_version_id,
        v.status, sk.retired_at, e.id, e.evaluator_version, e.rubric_version,
        e.outcome
      FROM attempts a JOIN study_sessions s ON s.id = a.study_session_id AND s.owner_id = a.owner_id
      JOIN questions q ON q.id = a.question_id
      JOIN content_versions v ON v.id = a.content_version_id
      JOIN skills sk ON sk.id = a.skill_id AND sk.language = a.language
      LEFT JOIN evaluations e ON e.attempt_id = a.id AND e.owner_id = a.owner_id
      WHERE a.owner_id = ? AND a.study_session_id = ?
      ORDER BY a.created_at, a.rowid, e.created_at, e.id`,
    args: [learner.userId, studySessionId]
  });
  const attempts = groupedAttempts(result.rows).map((evaluations) => {
    const row = evaluations[0];
    const evaluation = feedbackEvaluation(
      evaluations,
      String(row.content_version_id)
    );
    return { row, evaluation, outcome: evaluation?.outcome };
  });
  return attempts.map(grammarCandidate);
}

function isCurrentGrammarContent(row: Row) {
  if (row.retired_at !== null) return false;
  if (row.status === 'quarantined') return false;
  return row.current_version_id === row.content_version_id;
}

function grammarCandidate(attempt: {
  row: Row;
  evaluation: ReturnType<typeof feedbackEvaluation>;
  outcome: unknown;
}) {
  const { row, evaluation, outcome } = attempt;
  return {
    skillId: String(row.skill_id),
    outcome: outcome as GrammarOutcome,
    evidenceKind: String(row.evidence_kind) as 'independent' | 'assisted',
    receivedHelp: Boolean(row.received_help),
    notSure: Boolean(row.not_sure),
    available: isCurrentGrammarContent(row),
    rating: row.grammar_rating as GrammarRating | null,
    attemptId: String(row.attempt_id),
    evaluationId: evaluation ? String(evaluation.id) : '',
    contentVersionId: String(row.content_version_id),
    currentVersionId: String(row.current_version_id),
    lineageKey: effectiveLineageKey({
      lineageKey: row.lineage_key === null ? null : String(row.lineage_key),
      contentVersionId: String(row.content_version_id),
      questionId: String(row.question_id)
    })
  };
}

type GrammarCandidate = Awaited<ReturnType<typeof grammarCandidates>>[number];

async function persistGrammarSchedule(
  tx: Pick<Client, 'execute'>,
  input: {
    ownerId: string;
    language: string;
    skillId: string;
    currentVersion: string;
    expectedRevision: number;
    exists: boolean;
    scheduled: ReturnType<typeof scheduleStudyReview>;
  }
) {
  const {
    ownerId,
    language,
    skillId,
    currentVersion,
    expectedRevision,
    exists,
    scheduled
  } = input;
  const values = [
    currentVersion,
    scheduled.stateJson,
    scheduled.dueAt,
    scheduled.revision,
    scheduled.schedulerVersion,
    scheduled.parametersJson,
    ownerId,
    language,
    skillId
  ];
  if (!exists) {
    await tx.execute({
      sql: `INSERT INTO grammar_retention_schedules (content_version_id, state_json,
        due_at, revision, scheduler_version, parameters_json, owner_id, language, skill_id,
        reset_required) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      args: values
    });
    return;
  }
  const updated = await tx.execute({
    sql: `UPDATE grammar_retention_schedules SET content_version_id = ?, state_json = ?,
      due_at = ?, revision = ?, scheduler_version = ?, parameters_json = ?, reset_required = 0
      WHERE owner_id = ? AND language = ? AND skill_id = ? AND revision = ?`,
    args: [...values, expectedRevision]
  });
  if (updated.rowsAffected !== 1) throw new Error('Stale grammar schedule');
}

async function recordGrammarReviewEvent(
  tx: Pick<Client, 'execute'>,
  learner: LearnerSession,
  input: {
    studySessionId: string;
    language: string;
    source: GrammarCandidate;
    rating: GrammarRating;
    now: number;
    expectedRevision: number;
    scheduled: ReturnType<typeof scheduleStudyReview>;
  }
) {
  const {
    studySessionId,
    language,
    source,
    rating,
    now,
    expectedRevision,
    scheduled
  } = input;
  const skillId = source.skillId;
  await tx.execute({
    sql: `INSERT INTO grammar_retention_events (id, owner_id, study_session_id,
        language, skill_id, attempt_id, evaluation_id, content_version_id,
        lineage_key, expected_revision, rating, reviewed_at, scheduler_version,
        parameters_json, result_json, state_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      randomUUID(),
      learner.userId,
      studySessionId,
      language,
      skillId,
      source.attemptId,
      source.evaluationId,
      source.contentVersionId,
      source.lineageKey,
      expectedRevision,
      rating,
      now,
      scheduled.schedulerVersion,
      scheduled.parametersJson,
      scheduled.resultJson,
      scheduled.stateJson
    ]
  });
}

type GrammarSkillReview = {
  studySessionId: string;
  language: string;
  source: GrammarCandidate;
  rating: GrammarRating;
  studySchedule: Awaited<ReturnType<typeof getStudySchedule>>;
  timezone: string;
  now: number;
};

function scheduleGrammarCandidate(
  prior: Row | undefined,
  ownerId: string,
  input: GrammarSkillReview
) {
  const { language, source, rating, studySchedule, timezone, now } = input;
  const expectedRevision = prior ? Number(prior.revision) : 0;
  const scheduled = scheduleStudyReview({
    id: `${ownerId}:${language}:${source.skillId}`,
    rating,
    schedule: studySchedule,
    stateJson: prior ? String(prior.state_json) : null,
    schedulerVersion: prior ? String(prior.scheduler_version) : null,
    parametersJson: prior ? String(prior.parameters_json) : null,
    // Recall state carries over to new content versions; only a skill with
    // no schedule yet starts a new card.
    resetRequired: !prior,
    expectedRevision,
    now: new Date(now),
    timezone
  });
  return { expectedRevision, scheduled };
}

async function commitGrammarSkill(
  tx: Pick<Client, 'execute'>,
  learner: LearnerSession,
  input: GrammarSkillReview
) {
  const { studySessionId, language, source, rating, now } = input;
  const skillId = source.skillId;
  const duplicate = await tx.execute({
    sql: 'SELECT 1 FROM grammar_retention_events WHERE owner_id = ? AND study_session_id = ? AND skill_id = ?',
    args: [learner.userId, studySessionId, skillId]
  });
  if (duplicate.rows.length) return;
  const stored = await tx.execute({
    sql: 'SELECT content_version_id, state_json, revision, reset_required, scheduler_version, parameters_json FROM grammar_retention_schedules WHERE owner_id = ? AND language = ? AND skill_id = ?',
    args: [learner.userId, language, skillId]
  });
  const prior = stored.rows[0];
  const { expectedRevision, scheduled } = scheduleGrammarCandidate(
    prior,
    learner.userId,
    input
  );
  await persistGrammarSchedule(tx, {
    ownerId: learner.userId,
    language,
    skillId,
    currentVersion: source.currentVersionId,
    expectedRevision,
    exists: prior !== undefined,
    scheduled
  });
  await recordGrammarReviewEvent(tx, learner, {
    studySessionId,
    language,
    source,
    rating,
    now,
    expectedRevision,
    scheduled
  });
}

function completedGrammarLanguage(session: Row | undefined) {
  if (!session) return null;
  if (session.state !== 'completed') return null;
  if (
    session.grammar_retention_policy_version !==
    GRAMMAR_RETENTION_POLICY_VERSION
  )
    return null;
  return String(session.language);
}

function reviewSource(
  candidates: GrammarCandidate[],
  skillId: string,
  rating: GrammarRating
) {
  return candidates.find((candidate) => {
    if (candidate.skillId !== skillId) return false;
    if (!candidate.evaluationId) return false;
    return qualifyingRating(candidate) === rating;
  });
}

/** Commit at most one qualifying FSRS event per skill when the whole session finishes. */
export async function commitGrammarSessionReviews(
  tx: Pick<Client, 'execute'>,
  learner: LearnerSession,
  studySessionId: string,
  now = Date.now()
) {
  const sessionResult = await tx.execute({
    sql: 'SELECT language, state, grammar_retention_policy_version FROM study_sessions WHERE id = ? AND owner_id = ?',
    args: [studySessionId, learner.userId]
  });
  const language = completedGrammarLanguage(sessionResult.rows[0]);
  if (language === null) return;
  const candidates = await grammarCandidates(tx, learner, studySessionId);
  const ratings = aggregateGrammarRatings(candidates);
  const studySchedule = await getStudySchedule(tx, learner);
  const timezoneResult = await tx.execute({
    sql: 'SELECT timezone FROM learner_preferences WHERE owner_id = ?',
    args: [learner.userId]
  });
  const timezone = timezoneResult.rows[0]
    ? String(timezoneResult.rows[0].timezone)
    : 'UTC';

  for (const [skillId, rating] of ratings) {
    const source = reviewSource(candidates, skillId, rating);
    if (source)
      await commitGrammarSkill(tx, learner, {
        studySessionId,
        language,
        source,
        rating,
        studySchedule,
        timezone,
        now
      });
  }
}
