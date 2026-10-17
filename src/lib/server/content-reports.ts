import { randomUUID } from 'node:crypto';
import type { Client } from '@libsql/client';
import { beginWrite, type LearnerSession } from './flashcards';
import { StudyError } from './study-error';

export type ContentReportInput = {
  submissionKey: string;
  contentVersionId: string;
  questionId: string | null;
  category: string;
  comment: string;
};

export async function reportContentIssue(
  client: Client,
  learner: LearnerSession,
  input: ContentReportInput
) {
  if (
    typeof input.submissionKey !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(input.submissionKey) ||
    typeof input.contentVersionId !== 'string' ||
    !input.contentVersionId ||
    input.contentVersionId.length > 256 ||
    (input.questionId !== null &&
      (typeof input.questionId !== 'string' ||
        !input.questionId ||
        input.questionId.length > 256)) ||
    !['incorrect-answer', 'unclear', 'other'].includes(input.category) ||
    typeof input.comment !== 'string' ||
    input.comment.length > 2000 ||
    Array.from(input.comment).length > 1000 ||
    input.comment.includes('\0')
  )
    throw new StudyError('INVALID_REPORT');
  const comment = input.comment.normalize('NFC').trim();
  if (Array.from(comment).length > 1000) throw new StudyError('INVALID_REPORT');
  const tx = await beginWrite(client);
  try {
    const replay = await tx.execute({
      sql: 'SELECT * FROM content_reports WHERE owner_id = ? AND submission_key = ?',
      args: [learner.userId, input.submissionKey]
    });
    const prior = replay.rows[0];
    if (prior) {
      if (
        prior.content_version_id !== input.contentVersionId ||
        prior.question_id !== input.questionId ||
        prior.category !== input.category ||
        prior.comment !== comment
      )
        throw new StudyError('IDEMPOTENCY_CONFLICT');
      await tx.commit();
      return { id: String(prior.id), duplicate: true };
    }
    const target = await tx.execute({
      sql: `SELECT v.skill_id, v.language FROM content_versions v JOIN enrollments e ON e.language = v.language AND e.owner_id = ?
        WHERE v.id = ? AND (v.version = (SELECT MAX(v2.version) FROM content_versions v2 WHERE v2.skill_id = v.skill_id)
          OR EXISTS (SELECT 1 FROM attempts a WHERE a.owner_id = e.owner_id AND a.content_version_id = v.id))`,
      args: [learner.userId, input.contentVersionId]
    });
    const version = target.rows[0];
    if (!version) throw new StudyError('NOT_FOUND');
    const item =
      input.questionId === null
        ? await tx.execute({
            sql: 'SELECT 1 FROM lessons WHERE content_version_id = ?',
            args: [input.contentVersionId]
          })
        : await tx.execute({
            sql: `SELECT 1 FROM questions q WHERE q.id = ? AND q.content_version_id = ? AND (q.holdout = 0 OR EXISTS
          (SELECT 1 FROM attempts a JOIN study_sessions s ON s.id = a.study_session_id AND s.owner_id = a.owner_id
            WHERE a.owner_id = ? AND a.question_id = q.id AND s.mode = 'assessment' AND s.state = 'completed'))`,
            args: [input.questionId, input.contentVersionId, learner.userId]
          });
    if (!item.rows.length) throw new StudyError('NOT_FOUND');
    const count = await tx.execute({
      sql: "SELECT COUNT(*) AS n FROM content_reports WHERE owner_id = ? AND created_at >= CAST(strftime('%s', 'now', 'start of day') AS INTEGER) * 1000",
      args: [learner.userId]
    });
    if (Number(count.rows[0].n) >= 100) throw new StudyError('REPORT_LIMIT');
    const id = randomUUID();
    await tx.execute({
      sql: 'INSERT INTO content_reports (id, owner_id, submission_key, content_version_id, skill_id, language, question_id, category, comment) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [
        id,
        learner.userId,
        input.submissionKey,
        input.contentVersionId,
        version.skill_id,
        version.language,
        input.questionId,
        input.category,
        comment
      ]
    });
    await tx.commit();
    return { id, duplicate: false };
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    throw error;
  } finally {
    tx.close();
  }
}

export async function listContentReports(
  client: Pick<Client, 'execute'>,
  learner: LearnerSession
) {
  const result = await client.execute({
    sql: 'SELECT id, content_version_id, question_id, skill_id, category, comment, created_at FROM content_reports WHERE owner_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100',
    args: [learner.userId]
  });
  return result.rows.map((row) => ({
    id: String(row.id),
    contentVersionId: String(row.content_version_id),
    questionId: row.question_id === null ? null : String(row.question_id),
    skillId: String(row.skill_id),
    category: String(row.category),
    comment: String(row.comment),
    createdAt: Number(row.created_at)
  }));
}

export async function reportContentForm(
  client: Client,
  learner: LearnerSession,
  form: FormData
) {
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' ? value : '';
  };
  await reportContentIssue(client, learner, {
    submissionKey: text('submissionKey'),
    contentVersionId: text('contentVersionId'),
    questionId: text('questionId') || null,
    category: text('category'),
    comment: text('comment')
  });
  return { reported: true as const };
}
