import { randomUUID } from 'node:crypto';
import { fail } from '@sveltejs/kit';
import type { Client, Row } from '@libsql/client';
import {
  checkAnswer,
  checkAnswerText,
  normalizeAnswer
} from '../components/exercises/answer';
import type { FallbackEvaluator } from './evaluation/runtime';
import { describeLearnerError } from './learner-api';
import type { LearnerSession } from './learner-session';
import {
  findReplay,
  getLesson,
  nextQuestion,
  rateGrammarAttempt,
  recordAttempt,
  StudyError
} from './study';
import {
  nextQuestionIn,
  ownSession,
  sessionLessonIn,
  type SessionRow
} from './study-content';
import { feedbackOutcome } from './assessment';
import { GRAMMAR_RETENTION_POLICY_VERSION } from './grammar-retention';
import { reportContentForm } from './content-reports';
import { finishReviewedGrammarReview } from './practice';

// The practice half of the lesson page: serving the session's next exercise
// and recording the answer to it.

/**
 * The lesson of the page: as the learner's session sees it when the page was
 * opened from one, so the explanation matches the questions asked.
 */
export async function lessonFor(
  client: Client,
  learner: LearnerSession,
  page: { language: string; skillId: string; studySessionId: string | null }
) {
  if (!page.studySessionId)
    return getLesson(client, learner, page.language, page.skillId);
  const study = await ownSession(client, learner, page.studySessionId);
  if (study.language !== page.language) throw new StudyError('NOT_FOUND');
  return sessionLessonIn(client, learner, {
    studySessionId: page.studySessionId,
    skillId: page.skillId,
    study
  });
}

function needsPracticeRating(
  feedback: Awaited<ReturnType<typeof practiceFeedback>>
) {
  if (!feedback?.requiresRating) return false;
  if (feedback.outcome !== 'correct') return false;
  if (feedback.rating !== null) return false;
  return !feedback.receivedHelp;
}

/**
 * The next exercise of the learner's own session, when the page was opened
 * from one. A session that cannot serve a question yields a notice instead.
 */
export async function exerciseFor(
  client: Client,
  learner: LearnerSession,
  studySessionId: string | null,
  skillId: string
) {
  if (!studySessionId) return null;
  return exerciseAfter(
    client,
    learner,
    studySessionId,
    skillId,
    sessionFeedback(client, learner, studySessionId, skillId)
  );
}

/**
 * The practice half of the lesson page in one pass: the next exercise and the
 * feedback on the last answer, which the exercise depends on, so the feedback
 * is read once and shared instead of being read again for the page.
 */
export async function practiceFor(
  client: Client,
  learner: LearnerSession,
  studySessionId: string | null,
  skillId: string
) {
  if (!studySessionId)
    return {
      exercise: null,
      feedback: null,
      reviewSessionId: null,
      reviewFinished: false
    };
  const pending = sessionFeedback(client, learner, studySessionId, skillId);
  const [exercise, answered] = await Promise.all([
    exerciseAfter(client, learner, studySessionId, skillId, pending),
    pending
  ]);
  return {
    exercise,
    feedback: answered.feedback,
    // A grammar review is a list of topics, so its lessons lead back to it.
    reviewSessionId:
      answered.study.mode === 'mixed-review' ? studySessionId : null,
    reviewFinished:
      answered.study.mode === 'mixed-review' &&
      answered.study.state === 'completed'
  };
}

async function exerciseAfter(
  client: Client,
  learner: LearnerSession,
  studySessionId: string,
  skillId: string,
  pending: ReturnType<typeof sessionFeedback>
) {
  try {
    const { study, feedback } = await pending;
    if (needsPracticeRating(feedback))
      return {
        studySessionId,
        notice: 'Rate this answer before continuing with this topic.',
        question: null
      };
    // The session read for the feedback serves the question lookup too.
    return await nextExercise(studySessionId, () =>
      nextQuestionIn(client, learner, { studySessionId, skillId, study })
    );
  } catch (thrown) {
    return describedNotice(studySessionId, thrown);
  }
}

/** The session's next question as the page serves it, or a notice instead. */
async function nextExercise(
  studySessionId: string,
  read: () => ReturnType<typeof nextQuestion>
) {
  try {
    const next = await read();
    // One key per page load: a repeated tap of Submit replays, not duplicates.
    return {
      studySessionId,
      submissionKey: randomUUID(),
      notice: null,
      ...next
    };
  } catch (thrown) {
    return describedNotice(studySessionId, thrown);
  }
}

/** A learner-facing study error becomes a notice; anything else is rethrown. */
function describedNotice(studySessionId: string, thrown: unknown) {
  const described =
    thrown instanceof StudyError && describeLearnerError(thrown.code);
  if (!described) throw thrown;
  return { studySessionId, notice: described.message, question: null };
}

/**
 * Save a correct practice response's difficulty rating. The result carries the
 * session's next exercise, so the page moves on without reloading.
 */
export async function ratePracticeAnswer(
  client: Client,
  learner: LearnerSession,
  form: FormData,
  skillId: string
) {
  const attemptId = field(form, 'attemptId');
  const studySessionId = field(form, 'studySessionId');
  const rating = field(form, 'rating');
  if (!['hard', 'good', 'easy'].includes(rating))
    return fail(400, { message: 'Choose Hard, Good, or Easy.' });
  const rated = rating as 'hard' | 'good' | 'easy';
  // The skill, session and practice-mode checks run on the attempt rows the
  // rating transaction reads anyway.
  const { mode } = await rateGrammarAttempt(client, learner, {
    attemptId,
    rating: rated,
    expectedSessionId: studySessionId,
    practiceSkillId: skillId
  });
  // A grammar review finishes by itself once its last topic is rated.
  const reviewFinished = await finishReviewedGrammarReview(client, learner, {
    id: studySessionId,
    mode
  });
  return {
    rated: true as const,
    rating: rated,
    reviewFinished,
    exercise: await nextExercise(studySessionId, () =>
      nextQuestion(client, learner, studySessionId, skillId)
    )
  };
}

/**
 * Report on the lesson the page shows: the posted content version must be one
 * of this route's skill, so a report cannot be filed against an unrelated item.
 */
export async function reportLessonIssue(
  client: Client,
  learner: LearnerSession,
  form: FormData,
  page: { language: string; skillId: string }
) {
  const owned = await client.execute({
    sql: 'SELECT 1 FROM content_versions WHERE id = ? AND language = ? AND skill_id = ?',
    args: [field(form, 'contentVersionId'), page.language, page.skillId]
  });
  if (!owned.rows.length) throw new StudyError('NOT_FOUND');
  return reportContentForm(client, learner, form);
}

const field = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/**
 * A retry of an answer that was already recorded gets the original result,
 * even though the session has since moved on to its next question.
 */
async function repeatedAnswer(
  client: Client,
  learner: LearnerSession,
  form: FormData,
  session: { id: string; mode: string }
) {
  const studySessionId = session.id;
  const raw = form.get('intent') === 'unsure' ? '' : form.get('answer');
  if (typeof raw !== 'string') return null;
  const replay = await findReplay(client, learner, {
    studySessionId,
    questionId: field(form, 'questionId'),
    submissionKey: field(form, 'submissionKey'),
    evidenceKind: 'independent',
    answer: form.get('intent') === 'unsure' ? '' : normalizeAnswer(raw),
    notSure: form.get('intent') === 'unsure'
  });
  if (!replay) return null;
  // A retried last answer still finishes its review, even if the first try
  // stopped before it could.
  const reviewFinished = await finishReviewedGrammarReview(
    client,
    learner,
    session
  );
  return {
    recorded: true as const,
    duplicate: replay.duplicate,
    reviewFinished
  };
}

/** Record the answer to the question the session is currently on. */
export async function recordAnswer(
  client: Client,
  learner: LearnerSession,
  form: FormData,
  skillId: string,
  fallback?: FallbackEvaluator
) {
  const notSure = form.get('intent') === 'unsure';
  const text = checkAnswerText(form.get('answer'));
  if (!notSure && !text.ok) return fail(400, { message: text.message });
  const studySessionId = field(form, 'studySessionId');
  const study = await ownSession(client, learner, studySessionId);
  if (study.mode === 'assessment') throw new StudyError('ASSESSMENT_MODE');
  // Assisted retries are gone; a retry form from an older page is out of date.
  if (form.has('retryAttemptId')) throw new StudyError('STALE_QUESTION');
  const session = { id: studySessionId, mode: study.mode };
  const repeated = await repeatedAnswer(client, learner, form, session);
  if (repeated) return repeated;
  // The session read above is reused, so it costs no second round trip.
  const { question } = await nextQuestionIn(client, learner, {
    studySessionId,
    skillId,
    study
  });
  if (!question || question.id !== field(form, 'questionId')) {
    // A concurrent request may have recorded this very submission after the
    // first lookup; it is a retry then, not a stale question.
    const raced = await repeatedAnswer(client, learner, form, session);
    if (raced) return raced;
    throw new StudyError('STALE_QUESTION');
  }
  const checked = checkAnswer(
    question.format,
    form.get('answer'),
    question.alternatives
  );
  if (!notSure && !checked.ok) return fail(400, { message: checked.message });
  const attempt = await recordAttempt(
    client,
    learner,
    {
      studySessionId,
      questionId: question.id,
      submissionKey: field(form, 'submissionKey'),
      evidenceKind: 'independent',
      answer: notSure ? '' : checked.ok ? checked.answer : '',
      notSure
    },
    { fallback }
  );
  // A grammar review finishes by itself once its last topic is reviewed.
  const reviewFinished = await finishReviewedGrammarReview(
    client,
    learner,
    session
  );
  return {
    recorded: true as const,
    duplicate: attempt.duplicate,
    reviewFinished
  };
}

/** Practice feedback is persisted history, so a reload cannot erase or upgrade it. */
function practiceFeedbackFields(
  row: Row,
  evaluations: Row[],
  retentionPolicy: string | null
) {
  return {
    attemptId: String(row.id),
    questionId: String(row.question_id),
    contentVersionId: String(row.content_version_id),
    reportSubmissionKey: randomUUID(),
    answer: String(row.answer),
    expectedAnswer:
      row.expected_answer === null ? null : String(row.expected_answer),
    outcome: row.not_sure
      ? ('uncertain' as const)
      : feedbackOutcome(evaluations, String(row.content_version_id)),
    evidenceKind: String(row.evidence_kind),
    receivedHelp: Boolean(row.received_help),
    requiresRating: retentionPolicy === GRAMMAR_RETENTION_POLICY_VERSION,
    rating:
      row.grammar_rating === null
        ? null
        : (String(row.grammar_rating) as 'again' | 'hard' | 'good' | 'easy'),
    notSure: Boolean(row.not_sure)
  };
}

export async function practiceFeedback(
  client: Client,
  learner: LearnerSession,
  sessionId: string | null,
  skillId: string
) {
  if (!sessionId) return null;
  return (await sessionFeedback(client, learner, sessionId, skillId)).feedback;
}

/** The session row with the feedback on its last answer, read once for both. */
async function sessionFeedback(
  client: Client,
  learner: LearnerSession,
  sessionId: string,
  skillId: string
) {
  const study = await ownSession(client, learner, sessionId);
  if (study.mode === 'assessment') throw new StudyError('ASSESSMENT_MODE');
  return {
    study,
    feedback: await feedbackIn(client, learner, sessionId, skillId, study)
  };
}

async function feedbackIn(
  client: Client,
  learner: LearnerSession,
  sessionId: string,
  skillId: string,
  study: SessionRow
) {
  const found = await client.execute({
    sql: `SELECT a.*, q.answer AS expected_answer, v.status FROM attempts a
      JOIN questions q ON q.id = a.question_id JOIN content_versions v ON v.id = a.content_version_id
      WHERE a.owner_id = ? AND a.study_session_id = ? AND a.skill_id = ? AND q.holdout = 0
      ORDER BY a.created_at DESC, a.rowid DESC LIMIT 1`,
    args: [learner.userId, sessionId, skillId]
  });
  const row = found.rows[0];
  if (!row || row.status === 'quarantined') return null;
  const evaluations = await client.execute({
    sql: 'SELECT * FROM evaluations WHERE owner_id = ? AND attempt_id = ?',
    args: [learner.userId, row.id]
  });
  return practiceFeedbackFields(
    row,
    evaluations.rows,
    study.grammarRetentionPolicyVersion
  );
}
