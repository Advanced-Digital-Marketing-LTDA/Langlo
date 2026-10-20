import { randomUUID } from 'node:crypto';
import type { Client, Row } from '@libsql/client';
import {
  getStudySchedule,
  scheduleStudyReview,
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

/** One completed session contributes at most its lowest qualifying rating per skill. */
export function aggregateGrammarRatings(
  candidates: GrammarReviewCandidate[]
): Map<string, GrammarRating> {
  const result = new Map<string, GrammarRating>();
  for (const candidate of candidates) {
    if (
      !candidate.available ||
      candidate.receivedHelp ||
      candidate.notSure ||
      candidate.outcome === 'uncertain' ||
      (candidate.outcome === 'correct' && candidate.rating === null)
    )
      continue;
    const rating =
      candidate.outcome === 'incorrect' ? 'again' : candidate.rating;
    if (!rating) continue;
    const prior = result.get(candidate.skillId);
    if (!prior || ratingOrder.indexOf(rating) < ratingOrder.indexOf(prior))
      result.set(candidate.skillId, rating);
  }
  return result;
}

async function currentSkills(
  client: Pick<Client, 'execute'>,
  language: string
) {
  const result = await client.execute({
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
  });
  return result.rows;
}

/** Separate recall estimates from grammar-1 mastery; no schedule means not assessed. */
export async function grammarRetentionFor(
  client: Pick<Client, 'execute'>,
  learner: LearnerSession,
  language: string,
  now = Date.now()
): Promise<
  {
    skillId: string;
    title: string;
    available: boolean;
    retention: GrammarRetention;
  }[]
> {
  const [schedule, skills, stored] = await Promise.all([
    getStudySchedule(client, learner),
    currentSkills(client, language),
    client.execute({
      sql: `SELECT g.skill_id, g.content_version_id, g.state_json, g.due_at,
          g.reset_required, g.scheduler_version, g.parameters_json,
          (SELECT MAX(e.reviewed_at) FROM grammar_retention_events e
            WHERE e.owner_id = g.owner_id AND e.language = g.language AND e.skill_id = g.skill_id) AS last_reviewed_at
        FROM grammar_retention_schedules g WHERE g.owner_id = ? AND g.language = ?`,
      args: [learner.userId, language]
    })
  ]);
  const schedules = new Map(
    stored.rows.map((row) => [String(row.skill_id), row])
  );
  const target = schedule.desiredRetention / 100;
  return skills.map((skill) => {
    const row = schedules.get(String(skill.skill_id));
    const currentVersion = skill.content_version_id;
    const available =
      currentVersion !== null &&
      skill.content_status !== null &&
      Boolean(skill.has_lesson) &&
      Boolean(skill.has_question);
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
    const stale =
      Boolean(row.reset_required) || row.content_version_id !== currentVersion;
    const retrievability = stale
      ? null
      : studyRetrievability(
          {
            stateJson: String(row.state_json),
            schedulerVersion: String(row.scheduler_version),
            parametersJson: String(row.parameters_json)
          },
          new Date(now)
        );
    const dueAt = stale ? now : Number(row.due_at);
    const state: GrammarRetention['state'] = stale
      ? 'due'
      : dueAt < now
        ? 'overdue'
        : dueAt === now
          ? 'due'
          : retrievability !== null && retrievability < target
            ? 'below-target'
            : 'scheduled';
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
  });
}

/** The bounded, manually selectable set of due skills for a track. */
export async function dueGrammarReviews(
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
    .slice(0, 5)
    .map(({ skillId, title, retention }) => ({
      skillId,
      title,
      dueAt: retention.dueAt
    }));
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
  const session = sessionResult.rows[0];
  if (
    !session ||
    session.state !== 'completed' ||
    session.grammar_retention_policy_version !==
      GRAMMAR_RETENTION_POLICY_VERSION
  )
    return;
  const language = String(session.language);
  const result = await tx.execute({
    sql: `SELECT a.id AS attempt_id, a.owner_id, a.skill_id, a.language,
        a.question_id, a.content_version_id, a.evidence_kind, a.received_help,
        a.not_sure, a.grammar_rating, a.created_at, q.lineage_key,
        v.status, e.id, e.evaluator_version, e.rubric_version,
        e.outcome
      FROM attempts a JOIN study_sessions s ON s.id = a.study_session_id AND s.owner_id = a.owner_id
      JOIN questions q ON q.id = a.question_id
      JOIN content_versions v ON v.id = a.content_version_id
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
  const skillIds = [
    ...new Set(attempts.map(({ row }) => String(row.skill_id)))
  ];
  const current = new Map<string, string>();
  for (const skillId of skillIds) {
    const version = await tx.execute({
      sql: `SELECT id FROM content_versions WHERE skill_id = ? AND language = ?
        AND status IN ('schema-validated', 'pilot-ready') ORDER BY version DESC LIMIT 1`,
      args: [skillId, language]
    });
    if (version.rows[0]) current.set(skillId, String(version.rows[0].id));
  }
  const candidates = attempts.map(({ row, evaluation, outcome }) => ({
    skillId: String(row.skill_id),
    outcome: outcome as GrammarOutcome,
    evidenceKind: String(row.evidence_kind) as 'independent' | 'assisted',
    receivedHelp: Boolean(row.received_help),
    notSure: Boolean(row.not_sure),
    available:
      row.status !== 'quarantined' &&
      current.get(String(row.skill_id)) === String(row.content_version_id),
    rating: row.grammar_rating as GrammarRating | null,
    attemptId: String(row.attempt_id),
    evaluationId: evaluation ? String(evaluation.id) : '',
    contentVersionId: String(row.content_version_id),
    lineageKey: effectiveLineageKey({
      lineageKey: row.lineage_key === null ? null : String(row.lineage_key),
      contentVersionId: String(row.content_version_id),
      questionId: String(row.question_id)
    })
  }));
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
    const currentVersion = current.get(skillId);
    if (!currentVersion) continue;
    const source = candidates.find(
      (candidate) =>
        candidate.skillId === skillId &&
        (candidate.outcome === 'incorrect' ? 'again' : candidate.rating) ===
          rating &&
        candidate.available &&
        !candidate.receivedHelp &&
        !candidate.notSure &&
        (candidate.outcome === 'correct' ||
          candidate.outcome === 'incorrect') &&
        candidate.evaluationId
    );
    if (!source) continue;
    const duplicate = await tx.execute({
      sql: 'SELECT 1 FROM grammar_retention_events WHERE owner_id = ? AND study_session_id = ? AND skill_id = ?',
      args: [learner.userId, studySessionId, skillId]
    });
    if (duplicate.rows.length) continue;
    const stored = await tx.execute({
      sql: 'SELECT content_version_id, state_json, revision, reset_required, scheduler_version, parameters_json FROM grammar_retention_schedules WHERE owner_id = ? AND language = ? AND skill_id = ?',
      args: [learner.userId, language, skillId]
    });
    const prior = stored.rows[0];
    const expectedRevision = prior ? Number(prior.revision) : 0;
    const resetRequired =
      !prior ||
      Boolean(prior.reset_required) ||
      prior.content_version_id !== current.get(skillId);
    const scheduled = scheduleStudyReview({
      id: `${learner.userId}:${language}:${skillId}`,
      rating,
      schedule: studySchedule,
      stateJson: prior ? String(prior.state_json) : null,
      schedulerVersion: prior ? String(prior.scheduler_version) : null,
      parametersJson: prior ? String(prior.parameters_json) : null,
      resetRequired,
      expectedRevision,
      now: new Date(now),
      timezone
    });
    if (prior) {
      const updated = await tx.execute({
        sql: `UPDATE grammar_retention_schedules SET content_version_id = ?,
          state_json = ?, due_at = ?, revision = ?, reset_required = 0,
          scheduler_version = ?, parameters_json = ?
          WHERE owner_id = ? AND language = ? AND skill_id = ? AND revision = ?`,
        args: [
          currentVersion,
          scheduled.stateJson,
          scheduled.dueAt,
          scheduled.revision,
          scheduled.schedulerVersion,
          scheduled.parametersJson,
          learner.userId,
          language,
          skillId,
          expectedRevision
        ]
      });
      if (updated.rowsAffected !== 1) throw new Error('Stale grammar schedule');
    } else {
      await tx.execute({
        sql: `INSERT INTO grammar_retention_schedules (owner_id, language, skill_id,
          content_version_id, state_json, due_at, revision, reset_required,
          scheduler_version, parameters_json) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        args: [
          learner.userId,
          language,
          skillId,
          currentVersion,
          scheduled.stateJson,
          scheduled.dueAt,
          scheduled.revision,
          scheduled.schedulerVersion,
          scheduled.parametersJson
        ]
      });
    }
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
}
