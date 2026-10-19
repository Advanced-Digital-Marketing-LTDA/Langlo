import { createHash, randomUUID } from 'node:crypto';
import type { Client } from '@libsql/client';
import { createSourceId } from './db/source-id';
import { FALLBACK_EVALUATOR_VERSION } from './evaluation/fallback';
import { PREPARED_EVALUATOR_VERSION } from './evaluation/prepared';
import { createNote, FlashcardError, type LearnerSession } from './flashcards';

export { rejectNote, updateNote } from './flashcards';

const draftFormats = new Set(['basic', 'cloze']);
const maxExplanationLength = 600;
// The T003 compatibility proof accepts Basic and the restricted single-group
// Cloze form. This is the one place draft generation depends on that subset;
// widening it is a T003/T024 decision, not a generator detail.
const clozeBlank = '___';
const clozeSpanPattern = /\{\{c1::[^{}]+\}\}/gu;
const clozeNumberPattern = /\{\{c\d+::/u;

// The results page counts each attempt by the AI fallback's verdict, else the
// prepared verdict, else the newest evaluation (see practiceSummary). Card
// eligibility uses the same rule so the results list and this service cannot
// disagree about whether an answer is a confirmed mistake.
const evaluationOutcome = `(SELECT e.outcome FROM evaluations e
  WHERE e.attempt_id = a.id AND e.owner_id = a.owner_id
  ORDER BY CASE e.evaluator_version WHEN ? THEN 0 WHEN ? THEN 1 ELSE 2 END,
    e.created_at DESC, e.id DESC LIMIT 1)`;

type DraftFormat = 'basic' | 'cloze';

type MistakeRow = {
  attemptId: string;
  skillId: string;
  language: string;
  contentVersionId: string;
  notSure: number;
  mode: string;
  prompt: string | null;
  expectedAnswer: string | null;
  holdout: number;
  versionStatus: string;
  outcome: string | null;
  lessonExplanation: string | null;
};

function isNonEmptyString(value: unknown): value is string {
  return (
    typeof value === 'string' && value.trim() !== '' && !value.includes('\0')
  );
}

function truncateCodePoints(value: string, limit: number): string {
  const codePoints = Array.from(value);
  return codePoints.length > limit
    ? `${codePoints.slice(0, limit).join('')}…`
    : value;
}

/** The first paragraph of the lesson explanation, or a short answer note. */
function explanationFor(row: MistakeRow, answer: string): string {
  const lesson =
    typeof row.lessonExplanation === 'string' ? row.lessonExplanation : '';
  const [first = ''] = lesson.split(/\n\s*\n/u);
  const paragraph = first.trim();
  return truncateCodePoints(
    paragraph || `Correct answer: ${answer}.`,
    maxExplanationLength
  );
}

/** Read one of the caller's attempts with its evaluation, question and lesson. */
async function readMistake(
  client: Client,
  learner: LearnerSession,
  attemptId: string
): Promise<MistakeRow> {
  const result = await client.execute({
    sql: `SELECT a.id AS attempt_id,
        a.skill_id, a.language, a.content_version_id, a.not_sure,
        s.mode, q.prompt, q.answer AS expected_answer, q.holdout,
        v.status AS version_status,
        ${evaluationOutcome} AS outcome,
        COALESCE(lt.explanation, l.explanation) AS lesson_explanation
      FROM attempts a
      JOIN study_sessions s
        ON s.id = a.study_session_id AND s.owner_id = a.owner_id
      JOIN questions q
        ON q.id = a.question_id
        AND q.content_version_id = a.content_version_id
        AND q.skill_id = a.skill_id
        AND q.language = a.language
      JOIN content_versions v
        ON v.id = a.content_version_id
        AND v.skill_id = a.skill_id
        AND v.language = a.language
      LEFT JOIN lessons l ON l.content_version_id = a.content_version_id
      LEFT JOIN enrollments en
        ON en.owner_id = a.owner_id AND en.language = a.language
      LEFT JOIN lesson_translations lt
        ON lt.content_version_id = a.content_version_id
        AND lt.explanation_language = en.explanation_language
      WHERE a.id = ? AND a.owner_id = ?`,
    args: [
      FALLBACK_EVALUATOR_VERSION,
      PREPARED_EVALUATOR_VERSION,
      attemptId,
      learner.userId
    ]
  });
  const row = result.rows[0];
  if (!row) throw new FlashcardError('NOT_FOUND');
  return {
    attemptId: String(row.attempt_id),
    skillId: String(row.skill_id),
    language: String(row.language),
    contentVersionId: String(row.content_version_id),
    notSure: Number(row.not_sure),
    mode: String(row.mode),
    prompt: row.prompt === null ? null : String(row.prompt),
    expectedAnswer:
      row.expected_answer === null ? null : String(row.expected_answer),
    holdout: Number(row.holdout),
    versionStatus: String(row.version_status),
    outcome: row.outcome === null ? null : String(row.outcome),
    lessonExplanation:
      row.lesson_explanation === null ? null : String(row.lesson_explanation)
  };
}

/** Only a confirmed, incorrect, editable practice answer may become a card. */
function assertEligible(row: MistakeRow): void {
  // Assessment answers stay hidden until their results are available; those
  // results are handled by the assessment flow, not by card drafts. Keeping
  // the checks in one table also keeps the branch count stable as the rules
  // grow.
  const refusal = (
    [
      [row.mode !== 'practice', 'NOT_ELIGIBLE'],
      [row.outcome === null, 'NOT_CONFIRMED'],
      [row.outcome === 'uncertain', 'NOT_ELIGIBLE'],
      [row.outcome !== 'incorrect', 'NOT_A_MISTAKE'],
      [row.notSure !== 0, 'NOT_ELIGIBLE'],
      [row.holdout !== 0, 'NOT_ELIGIBLE'],
      [row.versionStatus === 'quarantined', 'CONTENT_UNAVAILABLE'],
      [
        !isNonEmptyString(row.prompt) ||
          !isNonEmptyString(row.expectedAnswer) ||
          typeof row.expectedAnswer !== 'string',
        'CONTENT_UNAVAILABLE'
      ]
    ] as const
  ).find(([refuse]) => refuse);
  if (refusal) throw new FlashcardError(refusal[1]);
}

type DraftContent =
  | { kind: 'basic'; content: { front: string; back: string } }
  | { kind: 'cloze'; content: { text: string } };

/** Basic Front/Back, or the restricted T003 Cloze form from a blank prompt. */
function draftContent(row: MistakeRow, format: DraftFormat): DraftContent {
  const prompt = row.prompt as string;
  const answer = row.expectedAnswer as string;
  if (format === 'basic')
    return { kind: 'basic' as const, content: { front: prompt, back: answer } };
  if (!prompt.includes(clozeBlank) || /[{}]/u.test(answer))
    throw new FlashcardError('INVALID_CLOZE');
  // The callback keeps `$&`, `$'` and similar sequences in the checked answer
  // literal instead of letting String.replace expand them.
  const text = prompt.replace(clozeBlank, () => `{{c1::${answer}}}`);
  if (clozeNumberPattern.test(text.replace(clozeSpanPattern, '')))
    throw new FlashcardError('INVALID_CLOZE');
  return { kind: 'cloze' as const, content: { text } };
}

/** One stable deck per learner and language for generated mistake cards. */
async function ensureMistakeDeck(
  client: Client,
  learner: LearnerSession,
  language: string
): Promise<string> {
  const id = `deck:mistakes:${createHash('sha256')
    .update(`${learner.userId}\0${language}`)
    .digest('hex')}`;
  await client.execute({
    sql: 'INSERT INTO native_flashcard_decks (id, owner_id, name) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING',
    args: [id, learner.userId, `Mistakes (${language})`]
  });
  return id;
}

async function findDraft(
  client: Client,
  learner: LearnerSession,
  attemptId: string
) {
  const result = await client.execute({
    sql: `SELECT n.id, c.id AS card_id, n.status
      FROM native_flashcard_notes n
      JOIN native_flashcards c
        ON c.note_id = n.id AND c.owner_id = n.owner_id
      WHERE n.owner_id = ? AND n.source_attempt_id = ?`,
    args: [learner.userId, attemptId]
  });
  const row = result.rows[0];
  return row
    ? {
        id: String(row.id),
        cardId: String(row.card_id),
        status: String(row.status)
      }
    : null;
}

function isDuplicateAttempt(error: unknown): boolean {
  const candidate = (error as { message?: unknown }).message;
  const message = typeof candidate === 'string' ? candidate : '';
  return (
    message.includes('native_flashcard_notes_owner_source_attempt_unique') ||
    message.includes('source_attempt_id')
  );
}

export type CreateMistakeDraftInput = {
  attemptId: unknown;
  format?: unknown;
};

/**
 * Generate one editable draft note from a confirmed eligible practice
 * mistake. Repeating the request returns the same native note and card.
 */
export async function createMistakeDraft(
  client: Client,
  learner: LearnerSession,
  input: CreateMistakeDraftInput
) {
  if (!isNonEmptyString(input.attemptId)) throw new FlashcardError('NOT_FOUND');
  const format = input.format ?? 'basic';
  if (typeof format !== 'string' || !draftFormats.has(format))
    throw new FlashcardError('INVALID_FORMAT');

  const row = await readMistake(client, learner, input.attemptId);
  assertEligible(row);

  const existing = await findDraft(client, learner, row.attemptId);
  if (existing) return { ...existing, duplicate: true };

  const draft = draftContent(row, format as DraftFormat);
  const deckId = await ensureMistakeDeck(client, learner, row.language);
  const common = {
    id: `note:${randomUUID()}`,
    sourceId: createSourceId({
      ownerId: learner.userId,
      language: row.language,
      skillId: row.skillId,
      canonicalMistake: `practice-mistake:${row.attemptId}`
    }),
    deckId,
    explanation: explanationFor(row, row.expectedAnswer as string),
    source: {
      attemptId: row.attemptId,
      skillId: row.skillId,
      contentVersionId: row.contentVersionId
    }
  };
  try {
    const created =
      draft.kind === 'basic'
        ? await createNote(client, learner, {
            ...common,
            kind: 'basic',
            content: draft.content
          })
        : await createNote(client, learner, {
            ...common,
            kind: 'cloze',
            content: draft.content
          });
    return { ...created, duplicate: false };
  } catch (error) {
    // Two tabs may race past the lookup; the unique attempt index keeps one
    // draft, and both callers receive it.
    if (isDuplicateAttempt(error)) {
      const raced = await findDraft(client, learner, row.attemptId);
      if (raced) return { ...raced, duplicate: true };
    }
    throw error;
  }
}

/** The confirmed mistakes of one practice session, with any draft already kept. */
export async function listMistakeCandidates(
  client: Client,
  learner: LearnerSession,
  studySessionId: string
) {
  if (!isNonEmptyString(studySessionId)) throw new FlashcardError('NOT_FOUND');
  const session = await client.execute({
    sql: "SELECT 1 FROM study_sessions WHERE id = ? AND owner_id = ? AND mode = 'practice'",
    args: [studySessionId, learner.userId]
  });
  if (!session.rows[0]) throw new FlashcardError('NOT_FOUND');

  const result = await client.execute({
    sql: `SELECT a.id AS attempt_id, a.skill_id, q.prompt, q.answer,
        (SELECT n.id FROM native_flashcard_notes n
          WHERE n.owner_id = a.owner_id AND n.source_attempt_id = a.id) AS draft_note_id
      FROM attempts a
      JOIN questions q
        ON q.id = a.question_id
        AND q.content_version_id = a.content_version_id
        AND q.skill_id = a.skill_id
        AND q.language = a.language
      JOIN content_versions v
        ON v.id = a.content_version_id
        AND v.skill_id = a.skill_id
        AND v.language = a.language
      WHERE a.study_session_id = ? AND a.owner_id = ?
        AND a.not_sure = 0
        AND q.prompt IS NOT NULL AND q.answer IS NOT NULL
        AND q.holdout = 0
        AND v.status <> 'quarantined'
        AND ${evaluationOutcome} = 'incorrect'
      ORDER BY a.created_at, a.id`,
    args: [
      studySessionId,
      learner.userId,
      FALLBACK_EVALUATOR_VERSION,
      PREPARED_EVALUATOR_VERSION
    ]
  });
  return result.rows.map((row) => ({
    attemptId: String(row.attempt_id),
    skillId: String(row.skill_id),
    prompt: String(row.prompt),
    answer: String(row.answer),
    draftNoteId: row.draft_note_id === null ? null : String(row.draft_note_id)
  }));
}
