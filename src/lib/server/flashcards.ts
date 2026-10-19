import {
  createEmptyCard,
  fsrs,
  checkParameters,
  generatorParameters,
  Rating,
  type Card,
  type Grade,
  type FSRSParameters
} from 'ts-fsrs';
import type { Client, Row } from '@libsql/client';
import { setTimeout as delay } from 'node:timers/promises';

export interface LearnerSession {
  userId: string;
}

type BasicContent = { front: string; back: string };
type ClozeContent = { text: string };
type Content = BasicContent | ClozeContent;
export type NoteSource = {
  attemptId: string;
  skillId: string;
  contentVersionId: string;
};

/** Map the persisted source columns of a note row, shared by every reader. */
export function noteSourceFrom(row: Row): NoteSource | null {
  if (row.source_attempt_id === null) return null;
  return {
    attemptId: String(row.source_attempt_id),
    skillId: String(row.source_skill_id),
    contentVersionId: String(row.source_content_version_id)
  };
}
type CreateNoteInput = {
  id: string;
  sourceId: string;
  deckId: string;
  explanation?: string;
  source?: NoteSource;
} & (
  | { kind: 'basic'; content: BasicContent }
  | { kind: 'cloze'; content: ClozeContent }
);
type RatingName = 'again' | 'hard' | 'good' | 'easy';

const schedulerVersion = 'ts-fsrs@5.4.2';
const parameters = generatorParameters();
const maxCardTextLength = 4096;
const maxExplanationLength = 1000;
const maxSourceFieldLength = 512;
const sourceIdPattern = /^langlo:v1:[0-9a-f]{64}$/u;
const ratings: Record<RatingName, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy
};

function exceedsCodePointLimit(value: string, limit: number): boolean {
  const codePoints = value[Symbol.iterator]();
  let count = 0;
  while (!codePoints.next().done) {
    if (++count > limit) return true;
  }
  return false;
}

export async function beginWrite(client: Client) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await client.transaction('write');
    } catch (error) {
      if ((error as { code?: string }).code !== 'SQLITE_BUSY' || attempt === 7)
        throw error;
      // Back off only after the failed write attempt finishes, then retry serially.
      await delay(10 * (attempt + 1));
    }
  }
}

export class FlashcardError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCardText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !!value.trim() &&
    !value.includes('\0') &&
    !exceedsCodePointLimit(value, maxCardTextLength)
  );
}

function validateContent(kind: unknown, content: unknown): void {
  if (!isRecord(content)) throw new FlashcardError('INVALID_CONTENT');

  if (kind === 'basic') {
    if (
      Object.keys(content).length !== 2 ||
      !isCardText(content.front) ||
      !isCardText(content.back)
    )
      throw new FlashcardError('INVALID_CONTENT');
  } else if (kind === 'cloze') {
    if (Object.keys(content).length !== 1 || !isCardText(content.text))
      throw new FlashcardError('INVALID_CONTENT');
    const matches = content.text.match(/\{\{c1::[^{}]+\}\}/gu) ?? [];
    if (
      !matches.length ||
      /\{\{c\d+::/u.test(content.text.replace(/\{\{c1::[^{}]+\}\}/gu, ''))
    ) {
      throw new FlashcardError('INVALID_CLOZE');
    }
  } else {
    throw new FlashcardError('INVALID_CONTENT');
  }
}

function isBoundedText(value: string, limit: number): boolean {
  if (value.includes('\0')) return false;
  return !exceedsCodePointLimit(value, limit);
}

function isNonEmptyBoundedText(value: unknown, limit: number): value is string {
  if (typeof value !== 'string') return false;
  if (value.trim() === '') return false;
  return isBoundedText(value, limit);
}

function isSourceId(value: unknown): value is string {
  return typeof value === 'string' && sourceIdPattern.test(value);
}

/** The optional short explanation shown beside a generated mistake card. */
function validateExplanation(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string')
    throw new FlashcardError('INVALID_EXPLANATION');
  if (!isBoundedText(value, maxExplanationLength))
    throw new FlashcardError('INVALID_EXPLANATION');
  return value;
}

function isSourceField(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.trim() === '') return false;
  return isBoundedText(value, maxSourceFieldLength);
}

/** The practice evidence a generated draft came from, all or nothing. */
function validateNoteSource(value: unknown): NoteSource | null {
  if (value === undefined) return null;
  if (!isRecord(value)) throw new FlashcardError('INVALID_SOURCE');
  const fields = [value.attemptId, value.skillId, value.contentVersionId];
  if (!fields.every(isSourceField)) throw new FlashcardError('INVALID_SOURCE');
  return {
    attemptId: value.attemptId as string,
    skillId: value.skillId as string,
    contentVersionId: value.contentVersionId as string
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasValidWeights(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    [17, 19, 21].includes(value.length) &&
    value.every((weight) => isFiniteNumber(weight))
  );
}

function hasValidSteps(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((step) => typeof step === 'string' && /^\d+[mhd]$/u.test(step))
  );
}

function hasValidSchedulerParameters(value: Record<string, unknown>): boolean {
  return (
    isFiniteNumber(value.request_retention) &&
    value.request_retention > 0 &&
    value.request_retention <= 1 &&
    isFiniteNumber(value.maximum_interval) &&
    value.maximum_interval > 0 &&
    hasValidWeights(value.w) &&
    typeof value.enable_fuzz === 'boolean' &&
    typeof value.enable_short_term === 'boolean' &&
    hasValidSteps(value.learning_steps) &&
    hasValidSteps(value.relearning_steps)
  );
}

function readCardScheduler(
  version: unknown,
  serializedParameters: string
): { scheduler: ReturnType<typeof fsrs>; parameters: FSRSParameters } {
  if (version !== schedulerVersion)
    throw new FlashcardError('UNSUPPORTED_SCHEDULER_VERSION');

  let parsed: unknown;
  try {
    parsed = JSON.parse(serializedParameters);
  } catch {
    throw new FlashcardError('INVALID_SCHEDULER_STATE');
  }
  if (!isRecord(parsed)) throw new FlashcardError('INVALID_SCHEDULER_STATE');

  if (!hasValidSchedulerParameters(parsed))
    throw new FlashcardError('INVALID_SCHEDULER_STATE');

  try {
    const stored = parsed as unknown as FSRSParameters;
    checkParameters(stored.w);
    const normalized = generatorParameters(stored);
    return { scheduler: fsrs(normalized), parameters: normalized };
  } catch {
    throw new FlashcardError('INVALID_SCHEDULER_STATE');
  }
}

function hasValidCardNumbers(card: Card): boolean {
  return (
    [
      card.stability,
      card.difficulty,
      card.elapsed_days,
      card.scheduled_days,
      card.learning_steps,
      card.reps,
      card.lapses,
      card.state
    ].every((value) => isFiniteNumber(value)) &&
    [card.stability, card.elapsed_days, card.scheduled_days].every(
      (value) => value >= 0
    ) &&
    card.difficulty >= 0 &&
    card.difficulty <= 10 &&
    [card.learning_steps, card.reps, card.lapses, card.state].every(
      (value) => Number.isInteger(value) && value >= 0
    ) &&
    card.state <= 3
  );
}

function decodeCard(serialized: string): Card {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new FlashcardError('INVALID_CARD_STATE');
  }
  if (!isRecord(parsed) || typeof parsed.due !== 'string')
    throw new FlashcardError('INVALID_CARD_STATE');
  const card = parsed as unknown as Card & {
    due: string;
    last_review?: string;
  };
  const due = new Date(card.due);
  const lastReview = card.last_review ? new Date(card.last_review) : undefined;
  if (
    !hasValidCardNumbers(card) ||
    Number.isNaN(due.getTime()) ||
    (card.last_review !== undefined &&
      (typeof card.last_review !== 'string' ||
        Number.isNaN(lastReview?.getTime())))
  ) {
    throw new FlashcardError('INVALID_CARD_STATE');
  }
  return {
    ...card,
    due,
    last_review: lastReview
  };
}

function encodeCard(card: Card): string {
  return JSON.stringify(card);
}

function newCard(now = new Date()): Card {
  return createEmptyCard(now);
}

export async function createDeck(
  client: Client,
  session: LearnerSession,
  input: { id: string; name: string }
) {
  if (
    !isRecord(input) ||
    typeof input.id !== 'string' ||
    !input.id.trim() ||
    input.id.includes('\0') ||
    typeof input.name !== 'string' ||
    !input.name.trim() ||
    input.name.includes('\0') ||
    exceedsCodePointLimit(input.name, 160)
  )
    throw new FlashcardError('INVALID_DECK');
  await client.execute({
    sql: 'INSERT INTO native_flashcard_decks (id, owner_id, name) VALUES (?, ?, ?)',
    args: [input.id, session.userId, input.name]
  });
}

type WriteTransaction = Awaited<ReturnType<typeof beginWrite>>;

function requireIdentityText(value: unknown) {
  if (!isNonEmptyBoundedText(value, maxCardTextLength))
    throw new FlashcardError('INVALID_NOTE');
}

function validateNoteIdentity(input: CreateNoteInput) {
  if (!isRecord(input)) throw new FlashcardError('INVALID_NOTE');
  requireIdentityText(input.id);
  requireIdentityText(input.deckId);
  if (!isSourceId(input.sourceId))
    throw new FlashcardError('INVALID_SOURCE_ID');
}

type NewNote = {
  input: CreateNoteInput;
  explanation: string;
  source: NoteSource | null;
  cardId: string;
  now: number;
};

async function insertNoteAndCard(
  tx: WriteTransaction,
  session: LearnerSession,
  note: NewNote
) {
  const { input, explanation, source, cardId, now } = note;
  const deck = await tx.execute({
    sql: 'SELECT 1 FROM native_flashcard_decks WHERE id = ? AND owner_id = ?',
    args: [input.deckId, session.userId]
  });
  if (!deck.rows[0]) throw new FlashcardError('NOT_FOUND');
  await tx.execute({
    sql: "INSERT INTO native_flashcard_notes (id, source_id, owner_id, deck_id, kind, content_json, status, explanation, source_skill_id, source_content_version_id, source_attempt_id) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)",
    args: [
      input.id,
      input.sourceId,
      session.userId,
      input.deckId,
      input.kind,
      JSON.stringify(input.content),
      explanation,
      source?.skillId ?? null,
      source?.contentVersionId ?? null,
      source?.attemptId ?? null
    ]
  });
  await tx.execute({
    sql: 'INSERT INTO native_flashcards (id, owner_id, note_id, state_json, due_at, scheduler_version, parameters_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
    args: [
      cardId,
      session.userId,
      input.id,
      encodeCard(newCard(new Date(now))),
      now,
      schedulerVersion,
      JSON.stringify(parameters)
    ]
  });
}

export async function createNote(
  client: Client,
  session: LearnerSession,
  input: CreateNoteInput
) {
  validateNoteIdentity(input);
  validateContent(input.kind, input.content);
  const explanation = validateExplanation(input.explanation);
  const source = validateNoteSource(input.source);
  const cardId = `card:${input.id}`;
  const now = newCard().due.getTime();
  const tx = await beginWrite(client);
  try {
    await insertNoteAndCard(tx, session, {
      input,
      explanation,
      source,
      cardId,
      now
    });
    await tx.commit();
    return { id: input.id, cardId, status: 'draft' as const };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}

export async function listDecks(client: Client, session: LearnerSession) {
  const result = await client.execute({
    sql: 'SELECT id, name, created_at FROM native_flashcard_decks WHERE owner_id = ? ORDER BY created_at, id',
    args: [session.userId]
  });
  return result.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    createdAt: Number(row.created_at)
  }));
}

/** Immutable review history for one of the caller's own cards. */
export async function listReviewEvents(
  client: Client,
  session: LearnerSession,
  cardId: string
) {
  const [card, events] = await client.batch(
    [
      {
        sql: 'SELECT 1 FROM native_flashcards WHERE id = ? AND owner_id = ?',
        args: [cardId, session.userId]
      },
      {
        sql: 'SELECT id, expected_revision, rating, reviewed_at, scheduler_version, result_json FROM native_flashcard_review_events WHERE owner_id = ? AND card_id = ? ORDER BY reviewed_at, id',
        args: [session.userId, cardId]
      }
    ],
    'read'
  );
  if (!card.rows[0]) throw new FlashcardError('NOT_FOUND');
  return events.rows.map((row) => ({
    id: String(row.id),
    expectedRevision: Number(row.expected_revision),
    rating: String(row.rating),
    reviewedAt: Number(row.reviewed_at),
    schedulerVersion: String(row.scheduler_version),
    result: JSON.parse(String(row.result_json)) as {
      revision: number;
      dueAt: number;
    }
  }));
}

export async function approveNote(
  client: Client,
  session: LearnerSession,
  noteId: string
) {
  const result = await client.execute({
    sql: "UPDATE native_flashcard_notes SET status = 'approved' WHERE id = ? AND owner_id = ? AND status = 'draft'",
    args: [noteId, session.userId]
  });
  if (result.rowsAffected !== 1) throw new FlashcardError('NOT_FOUND');
}

/**
 * Edit a draft or approved note's content in place. The note and generated
 * card keep their ids, so an Anki GUID and any review history stay attached
 * to the same identity. A rejected draft is final and cannot be revived.
 */
type EditInput = {
  kind?: unknown;
  content?: unknown;
  explanation?: unknown;
};
type NoteEdit = {
  kind: 'basic' | 'cloze';
  content: Content;
  explanation: string;
  status: string;
};

async function readEditableNote(
  tx: WriteTransaction,
  session: LearnerSession,
  noteId: string
): Promise<Row> {
  const found = await tx.execute({
    sql: 'SELECT kind, content_json, explanation, status FROM native_flashcard_notes WHERE id = ? AND owner_id = ?',
    args: [noteId, session.userId]
  });
  const row = found.rows[0];
  if (!row) throw new FlashcardError('NOT_FOUND');
  if (row.status === 'rejected') throw new FlashcardError('NOT_EDITABLE');
  return row;
}

function editKind(row: Row, input: EditInput): 'basic' | 'cloze' {
  const kind = input.kind === undefined ? String(row.kind) : input.kind;
  if (kind === 'basic' || kind === 'cloze') return kind;
  throw new FlashcardError('INVALID_CONTENT');
}

function editContent(
  row: Row,
  input: EditInput,
  kind: 'basic' | 'cloze'
): Content {
  const content =
    input.content === undefined
      ? JSON.parse(String(row.content_json))
      : input.content;
  validateContent(kind, content);
  return content as Content;
}

function editExplanation(row: Row, input: EditInput): string {
  return input.explanation === undefined
    ? String(row.explanation)
    : validateExplanation(input.explanation);
}

async function applyNoteEdit(
  tx: WriteTransaction,
  session: LearnerSession,
  noteId: string,
  edit: NoteEdit
): Promise<number | null> {
  const changed = await tx.execute({
    sql: "UPDATE native_flashcard_notes SET kind = ?, content_json = ?, explanation = ? WHERE id = ? AND owner_id = ? AND status <> 'rejected'",
    args: [
      edit.kind,
      JSON.stringify(edit.content),
      edit.explanation,
      noteId,
      session.userId
    ]
  });
  if (changed.rowsAffected !== 1) throw new FlashcardError('NOT_EDITABLE');
  if (edit.status !== 'approved') return null;

  // An open review form carries the revision it loaded. Bumping the card
  // revision in the same transaction invalidates that stale form instead of
  // letting a rating for the old content be recorded against the new content.
  const bumped = await tx.execute({
    sql: 'UPDATE native_flashcards SET revision = revision + 1 WHERE note_id = ? AND owner_id = ?',
    args: [noteId, session.userId]
  });
  if (bumped.rowsAffected < 1) throw new FlashcardError('NOT_FOUND');
  const current = await tx.execute({
    sql: 'SELECT revision FROM native_flashcards WHERE note_id = ? AND owner_id = ?',
    args: [noteId, session.userId]
  });
  return Number(current.rows[0].revision);
}

/**
 * Edit a draft or approved note's content in place. The note and generated
 * card keep their ids, so an Anki GUID and any review history stay attached
 * to the same identity. A rejected draft is final and cannot be revived.
 */
export async function updateNote(
  client: Client,
  session: LearnerSession,
  noteId: string,
  input: EditInput
) {
  const tx = await beginWrite(client);
  try {
    const row = await readEditableNote(tx, session, noteId);
    const kind = editKind(row, input);
    const edit: NoteEdit = {
      kind,
      content: editContent(row, input, kind),
      explanation: editExplanation(row, input),
      status: String(row.status)
    };
    const revision = await applyNoteEdit(tx, session, noteId, edit);
    await tx.commit();
    return { id: noteId, ...edit, revision };
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    throw error;
  } finally {
    tx.close();
  }
}

/**
 * Reject one of the caller's own notes. A rejected note is never due, never
 * reviewable and never exported. Repeating the action succeeds.
 */
export async function rejectNote(
  client: Client,
  session: LearnerSession,
  noteId: string
) {
  const changed = await client.execute({
    sql: "UPDATE native_flashcard_notes SET status = 'rejected' WHERE id = ? AND owner_id = ? AND status IN ('draft', 'approved')",
    args: [noteId, session.userId]
  });
  if (changed.rowsAffected === 1)
    return { id: noteId, status: 'rejected' as const };

  const existing = await client.execute({
    sql: 'SELECT status FROM native_flashcard_notes WHERE id = ? AND owner_id = ?',
    args: [noteId, session.userId]
  });
  if (!existing.rows[0]) throw new FlashcardError('NOT_FOUND');
  if (existing.rows[0].status === 'rejected')
    return { id: noteId, status: 'rejected' as const };
  throw new FlashcardError('NOT_EDITABLE');
}

export async function getNote(
  client: Client,
  session: LearnerSession,
  noteId: string
) {
  const result = await client.execute({
    sql: 'SELECT n.id, n.source_id, n.owner_id, n.deck_id, n.kind, n.content_json, n.status, n.explanation, n.source_skill_id, n.source_content_version_id, n.source_attempt_id, c.id AS card_id, c.state_json, c.due_at, c.revision, c.suspended, c.scheduler_version, c.parameters_json FROM native_flashcard_notes n JOIN native_flashcards c ON c.note_id = n.id AND c.owner_id = n.owner_id WHERE n.id = ? AND n.owner_id = ?',
    args: [noteId, session.userId]
  });
  const row = result.rows[0];
  if (!row) throw new FlashcardError('NOT_FOUND');
  const cardScheduler = readCardScheduler(
    row.scheduler_version,
    String(row.parameters_json)
  );
  return {
    id: String(row.id),
    sourceId: String(row.source_id),
    ownerId: String(row.owner_id),
    deckId: String(row.deck_id),
    kind: String(row.kind),
    content: JSON.parse(String(row.content_json)) as Content,
    status: String(row.status),
    explanation: String(row.explanation),
    source: noteSourceFrom(row),
    card: {
      id: String(row.card_id),
      state: decodeCard(String(row.state_json)),
      dueAt: Number(row.due_at),
      revision: Number(row.revision),
      suspended: Boolean(row.suspended),
      schedulerVersion: String(row.scheduler_version),
      parameters: cardScheduler.parameters
    }
  };
}

export async function submitReview(
  client: Client,
  session: LearnerSession,
  input: {
    cardId: string;
    submissionId: string;
    expectedRevision: number;
    rating: RatingName;
  }
) {
  if (
    typeof input.submissionId !== 'string' ||
    input.submissionId.trim().length < 1 ||
    exceedsCodePointLimit(input.submissionId, 256)
  ) {
    throw new FlashcardError('INVALID_SUBMISSION_ID');
  }
  if (!Object.hasOwn(ratings, input.rating))
    throw new FlashcardError('INVALID_RATING');
  const tx = await beginWrite(client);
  try {
    const previous = await tx.execute({
      sql: 'SELECT card_id, expected_revision, rating, reviewed_at, result_json FROM native_flashcard_review_events WHERE owner_id = ? AND id = ?',
      args: [session.userId, input.submissionId]
    });
    if (previous.rows[0]) {
      const row = previous.rows[0];
      if (
        row.card_id !== input.cardId ||
        Number(row.expected_revision) !== input.expectedRevision ||
        row.rating !== input.rating
      )
        throw new FlashcardError('IDEMPOTENCY_CONFLICT');
      await tx.commit();
      return {
        ...(JSON.parse(String(row.result_json)) as {
          revision: number;
          dueAt: number;
        }),
        duplicate: true
      };
    }

    const found = await tx.execute({
      sql: 'SELECT c.state_json, c.revision, c.suspended, c.scheduler_version, c.parameters_json, n.status FROM native_flashcards c JOIN native_flashcard_notes n ON n.id = c.note_id AND n.owner_id = c.owner_id WHERE c.id = ? AND c.owner_id = ?',
      args: [input.cardId, session.userId]
    });
    const cardRow = found.rows[0];
    if (!cardRow) throw new FlashcardError('NOT_FOUND');
    if (cardRow.status !== 'approved') throw new FlashcardError('NOT_APPROVED');
    if (Number(cardRow.suspended) !== 0) throw new FlashcardError('SUSPENDED');
    if (Number(cardRow.revision) !== input.expectedRevision)
      throw new FlashcardError('STALE_REVIEW');

    const cardScheduler = readCardScheduler(
      cardRow.scheduler_version,
      String(cardRow.parameters_json)
    );

    const reviewedAt = new Date();
    const updated = cardScheduler.scheduler.next(
      decodeCard(String(cardRow.state_json)),
      reviewedAt,
      ratings[input.rating]
    ).card;
    const revision = input.expectedRevision + 1;
    const result = { revision, dueAt: updated.due.getTime() };
    const changed = await tx.execute({
      sql: 'UPDATE native_flashcards SET state_json = ?, due_at = ?, revision = ? WHERE id = ? AND owner_id = ? AND revision = ?',
      args: [
        encodeCard(updated),
        result.dueAt,
        revision,
        input.cardId,
        session.userId,
        input.expectedRevision
      ]
    });
    if (changed.rowsAffected !== 1) throw new FlashcardError('STALE_REVIEW');
    await tx.execute({
      sql: 'INSERT INTO native_flashcard_review_events (id, owner_id, card_id, expected_revision, rating, reviewed_at, scheduler_version, parameters_json, result_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [
        input.submissionId,
        session.userId,
        input.cardId,
        input.expectedRevision,
        input.rating,
        reviewedAt.getTime(),
        String(cardRow.scheduler_version),
        JSON.stringify(cardScheduler.parameters),
        JSON.stringify(result)
      ]
    });
    await tx.commit();
    return { ...result, duplicate: false };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}
