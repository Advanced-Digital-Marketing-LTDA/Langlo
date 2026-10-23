import {
  createEmptyCard,
  fsrs,
  checkParameters,
  generatorParameters,
  GenSeedStrategyWithCardId,
  Rating,
  StrategyMode,
  type Card,
  type Grade,
  type FSRSParameters
} from 'ts-fsrs';
import type { Client, InStatement, Row } from '@libsql/client';
import { beginWrite, executeWrite } from './db-transactions';
export { beginRead, beginWrite, executeWrite } from './db-transactions';
import { studyDayStart } from './study-days';
import {
  FlashcardError,
  exceedsCodePointLimit,
  isNonEmptyBoundedText,
  isRecord,
  isSourceId,
  maxCardTextLength,
  normalizeTags,
  validateContent,
  validateExplanation,
  validateNoteSource
} from './flashcard-validation';
export { FlashcardError } from './flashcard-validation';

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
export type NewCardPreset = '10m' | '1m+10m' | '30m';
export type RelearningPreset = '10m' | '30m' | '1h';
export type StudySchedule = {
  desiredRetention: number;
  newCardPreset: NewCardPreset;
  relearningPreset: RelearningPreset;
};

type CreateNoteInput = {
  id: string;
  sourceId: string;
  deckId: string;
  explanation?: string;
  tags?: unknown;
  source?: NoteSource;
} & (
  | { kind: 'basic'; content: BasicContent }
  | { kind: 'cloze'; content: ClozeContent }
);
type RatingName = 'again' | 'hard' | 'good' | 'easy';
type ReviewInput = {
  cardId: string;
  submissionId: string;
  expectedRevision: number;
  rating: RatingName;
  expectedScheduleKey?: string;
};
type ReviewResult = { revision: number; dueAt: number; duplicate: boolean };

const schedulerVersion = 'ts-fsrs@5.4.2';
const parameters = generatorParameters({ enable_fuzz: true });
const defaultStudySchedule: StudySchedule = {
  desiredRetention: 90,
  newCardPreset: '1m+10m',
  relearningPreset: '10m'
};
const newCardSteps = {
  '10m': ['10m'],
  '1m+10m': ['1m', '10m'],
  '30m': ['30m']
} as const;
const relearningSteps = {
  '10m': ['10m'],
  '30m': ['30m'],
  '1h': ['1h']
} as const;
const reviewIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ratings: Record<RatingName, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy
};

function isStudySchedule(value: unknown): value is StudySchedule {
  if (!isRecord(value)) return false;
  return (
    Number.isInteger(value.desiredRetention) &&
    Number(value.desiredRetention) >= 70 &&
    Number(value.desiredRetention) <= 97 &&
    ['10m', '1m+10m', '30m'].includes(String(value.newCardPreset)) &&
    ['10m', '30m', '1h'].includes(String(value.relearningPreset))
  );
}

function validateStudySchedule(value: unknown): StudySchedule {
  if (!isStudySchedule(value))
    throw new FlashcardError('INVALID_STUDY_SCHEDULE');
  return value;
}

function parametersForSchedule(
  schedule: StudySchedule,
  base: FSRSParameters = parameters
): FSRSParameters {
  return generatorParameters({
    ...base,
    request_retention: schedule.desiredRetention / 100,
    learning_steps: newCardSteps[
      schedule.newCardPreset
    ] as FSRSParameters['learning_steps'],
    relearning_steps: relearningSteps[
      schedule.relearningPreset
    ] as FSRSParameters['relearning_steps'],
    enable_fuzz: true
  });
}

/** The read `readStudySchedule` is built from, so a caller can batch it. */
export function studyScheduleStatement(ownerId: string): InStatement {
  return {
    sql: 'SELECT desired_retention, new_card_preset, relearning_preset FROM native_flashcard_preferences WHERE owner_id = ?',
    args: [ownerId]
  };
}

export function studyScheduleOf(rows: Row[]): StudySchedule {
  const row = rows[0];
  return row
    ? {
        desiredRetention: Number(row.desired_retention),
        newCardPreset: String(row.new_card_preset) as NewCardPreset,
        relearningPreset: String(row.relearning_preset) as RelearningPreset
      }
    : defaultStudySchedule;
}

async function readStudySchedule(
  client: Pick<Client, 'execute'>,
  ownerId: string
): Promise<StudySchedule> {
  const result = await client.execute(studyScheduleStatement(ownerId));
  return studyScheduleOf(result.rows);
}

export async function getStudySchedule(
  client: Pick<Client, 'execute'>,
  session: LearnerSession
): Promise<StudySchedule> {
  return readStudySchedule(client, session.userId);
}

export async function saveStudySchedule(
  client: Client,
  session: LearnerSession,
  input: unknown
): Promise<StudySchedule> {
  const schedule = validateStudySchedule(input);
  await executeWrite(client, {
    sql: `INSERT INTO native_flashcard_preferences (owner_id, desired_retention, new_card_preset, relearning_preset)
      VALUES (?, ?, ?, ?) ON CONFLICT (owner_id) DO UPDATE SET
      desired_retention = excluded.desired_retention,
      new_card_preset = excluded.new_card_preset,
      relearning_preset = excluded.relearning_preset,
      updated_at = unixepoch() * 1000`,
    args: [
      session.userId,
      schedule.desiredRetention,
      schedule.newCardPreset,
      schedule.relearningPreset
    ]
  });
  return schedule;
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

function deterministicScheduler(parameters_: FSRSParameters) {
  return fsrs(parameters_).useStrategy(
    StrategyMode.SEED,
    GenSeedStrategyWithCardId('card_id')
  );
}

function cardWithId(card: Card, cardId: string) {
  return { ...card, card_id: cardId };
}

function withoutCardId(card: Card & { card_id?: string }): Card {
  const state = { ...card };
  delete state.card_id;
  return state;
}

function scheduledCard(
  card: Card & { card_id?: string },
  now: Date,
  timezone: string
): Card {
  const updated = withoutCardId(card);
  if (updated.scheduled_days >= 1) {
    updated.due = studyDayStart(
      now,
      timezone,
      Math.max(1, Math.round(updated.scheduled_days))
    );
  }
  return updated;
}

function intervalLabel(card: Card, now: Date): string {
  if (card.scheduled_days >= 1) return `${Math.round(card.scheduled_days)}d`;
  const minutes = Math.max(
    1,
    Math.round((card.due.getTime() - now.getTime()) / 60_000)
  );
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

export function ratingIntervals(
  card: Card,
  cardId: string,
  baseParameters: FSRSParameters,
  schedule: StudySchedule,
  now = new Date()
) {
  const params = parametersForSchedule(schedule, baseParameters);
  const preview = deterministicScheduler(params).repeat(
    cardWithId(card, cardId),
    now
  );
  return {
    again: intervalLabel(preview[Rating.Again].card, now),
    hard: intervalLabel(preview[Rating.Hard].card, now),
    good: intervalLabel(preview[Rating.Good].card, now),
    easy: intervalLabel(preview[Rating.Easy].card, now)
  };
}

export function ratingIntervalsForStoredCard(
  row: Row,
  schedule: StudySchedule,
  now: Date
) {
  return ratingIntervals(
    decodeCard(String(row.state_json)),
    String(row.id),
    readCardScheduler(row.scheduler_version, String(row.parameters_json))
      .parameters,
    schedule,
    now
  );
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

/** Apply one persisted review with the same scheduler and settings as flashcards. */
export function scheduleStudyReview(input: {
  id: string;
  rating: RatingName;
  schedule: StudySchedule;
  stateJson: string | null;
  schedulerVersion: string | null;
  parametersJson: string | null;
  resetRequired: boolean;
  expectedRevision: number;
  now: Date;
  timezone: string;
}) {
  const baseParameters = input.parametersJson
    ? readCardScheduler(input.schedulerVersion, input.parametersJson).parameters
    : parameters;
  const effectiveParameters = parametersForSchedule(
    input.schedule,
    baseParameters
  );
  const card =
    input.stateJson && !input.resetRequired
      ? decodeCard(input.stateJson)
      : newCard(input.now);
  const updated = scheduledCard(
    deterministicScheduler(effectiveParameters).next(
      cardWithId(card, input.id),
      input.now,
      ratings[input.rating]
    ).card,
    input.now,
    input.timezone
  );
  const result = {
    revision: input.expectedRevision + 1,
    dueAt: updated.due.getTime()
  };
  return {
    schedulerVersion,
    parametersJson: JSON.stringify(effectiveParameters),
    stateJson: encodeCard(updated),
    resultJson: JSON.stringify(result),
    revision: result.revision,
    dueAt: result.dueAt
  };
}

export function studyRetrievability(
  input: {
    stateJson: string;
    schedulerVersion: string;
    parametersJson: string;
  },
  now: Date
) {
  return readCardScheduler(
    input.schedulerVersion,
    input.parametersJson
  ).scheduler.get_retrievability(decodeCard(input.stateJson), now, false);
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
  await executeWrite(client, {
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
  tags: string[];
  source: NoteSource | null;
};

async function insertNote(
  tx: WriteTransaction,
  session: LearnerSession,
  note: NewNote
) {
  const { input, explanation, tags, source } = note;
  const deck = await tx.execute({
    sql: 'SELECT 1 FROM native_flashcard_decks WHERE id = ? AND owner_id = ?',
    args: [input.deckId, session.userId]
  });
  if (!deck.rows[0]) throw new FlashcardError('NOT_FOUND');
  await tx.execute({
    sql: "INSERT INTO native_flashcard_notes (id, source_id, owner_id, deck_id, kind, content_json, status, explanation, tags_json, source_skill_id, source_content_version_id, source_attempt_id) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)",
    args: [
      input.id,
      input.sourceId,
      session.userId,
      input.deckId,
      input.kind,
      JSON.stringify(input.content),
      explanation,
      JSON.stringify(tags),
      source?.skillId ?? null,
      source?.contentVersionId ?? null,
      source?.attemptId ?? null
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
  const tags = normalizeTags(input.tags);
  const source = validateNoteSource(input.source);
  const cardId = `card:${input.id}`;
  const tx = await beginWrite(client);
  try {
    await insertNote(tx, session, { input, explanation, tags, source });
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
        sql: 'SELECT id, expected_revision, rating, reviewed_at, scheduler_version, parameters_json, result_json, state_json FROM native_flashcard_review_events WHERE owner_id = ? AND card_id = ? ORDER BY reviewed_at, id',
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
    parameters: JSON.parse(String(row.parameters_json)) as FSRSParameters,
    state: row.state_json === null ? null : decodeCard(String(row.state_json)),
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
  const tx = await beginWrite(client);
  try {
    const found = await tx.execute({
      sql: "SELECT 1 FROM native_flashcard_notes WHERE id = ? AND owner_id = ? AND status = 'draft'",
      args: [noteId, session.userId]
    });
    if (!found.rows[0]) throw new FlashcardError('NOT_FOUND');
    const cardParameters = parametersForSchedule(
      await readStudySchedule(tx, session.userId)
    );
    const card = newCard();
    await tx.execute({
      sql: 'INSERT INTO native_flashcards (id, owner_id, note_id, state_json, due_at, scheduler_version, parameters_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [
        `card:${noteId}`,
        session.userId,
        noteId,
        encodeCard(card),
        card.due.getTime(),
        schedulerVersion,
        JSON.stringify(cardParameters)
      ]
    });
    const changed = await tx.execute({
      sql: "UPDATE native_flashcard_notes SET status = 'approved' WHERE id = ? AND owner_id = ? AND status = 'draft'",
      args: [noteId, session.userId]
    });
    if (changed.rowsAffected !== 1) throw new FlashcardError('NOT_FOUND');
    await tx.commit();
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    throw error;
  } finally {
    tx.close();
  }
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
  tags?: unknown;
  deckId?: unknown;
};
type NoteEdit = {
  kind: 'basic' | 'cloze';
  content: Content;
  explanation: string;
  tags: string[];
  deckId: string;
  contentChanged: boolean;
  status: string;
};

async function readEditableNote(
  tx: WriteTransaction,
  session: LearnerSession,
  noteId: string
): Promise<Row> {
  const found = await tx.execute({
    sql: 'SELECT kind, content_json, explanation, tags_json, deck_id, status FROM native_flashcard_notes WHERE id = ? AND owner_id = ?',
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
    sql: "UPDATE native_flashcard_notes SET kind = ?, content_json = ?, explanation = ?, tags_json = ?, deck_id = ? WHERE id = ? AND owner_id = ? AND status <> 'rejected'",
    args: [
      edit.kind,
      JSON.stringify(edit.content),
      edit.explanation,
      JSON.stringify(edit.tags),
      edit.deckId,
      noteId,
      session.userId
    ]
  });
  if (changed.rowsAffected !== 1) throw new FlashcardError('NOT_EDITABLE');
  if (edit.status !== 'approved') return null;
  if (!edit.contentChanged) {
    const current = await tx.execute({
      sql: 'SELECT revision FROM native_flashcards WHERE note_id = ? AND owner_id = ?',
      args: [noteId, session.userId]
    });
    if (!current.rows[0]) throw new FlashcardError('NOT_FOUND');
    return Number(current.rows[0].revision);
  }

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
    const deckId =
      input.deckId === undefined ? String(row.deck_id) : input.deckId;
    if (typeof deckId !== 'string' || !deckId.trim())
      throw new FlashcardError('INVALID_NOTE');
    const deck = await tx.execute({
      sql: 'SELECT 1 FROM native_flashcard_decks WHERE id = ? AND owner_id = ?',
      args: [deckId, session.userId]
    });
    if (!deck.rows[0]) throw new FlashcardError('NOT_FOUND');
    const content = editContent(row, input, kind);
    const explanation = editExplanation(row, input);
    const edit: NoteEdit = {
      kind,
      content,
      explanation,
      tags:
        input.tags === undefined
          ? (JSON.parse(String(row.tags_json)) as string[])
          : normalizeTags(input.tags),
      deckId,
      contentChanged:
        kind !== String(row.kind) ||
        JSON.stringify(content) !== String(row.content_json) ||
        explanation !== String(row.explanation),
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
  const changed = await executeWrite(client, {
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

function cardFromNoteRow(row: Row) {
  if (row.card_id === null) throw new FlashcardError('INVALID_CARD_STATE');
  return {
    id: String(row.card_id),
    state: decodeCard(String(row.state_json)),
    dueAt: Number(row.due_at),
    revision: Number(row.revision),
    suspended: Boolean(row.suspended),
    schedulerVersion: String(row.scheduler_version),
    parameters: readCardScheduler(
      row.scheduler_version,
      String(row.parameters_json)
    ).parameters
  };
}

function noteFromRow(row: Row) {
  if (row.status === 'approved') {
    const card = cardFromNoteRow(row);
    return {
      ...noteContentFromRow(row),
      status: 'approved' as const,
      card
    };
  }
  const note = noteContentFromRow(row);
  if (row.status !== 'draft' && row.status !== 'rejected')
    throw new FlashcardError('INVALID_NOTE_STATE');
  return { ...note, status: row.status, card: null };
}

function noteContentFromRow(row: Row) {
  return {
    id: String(row.id),
    cardId: `card:${String(row.id)}`,
    sourceId: String(row.source_id),
    ownerId: String(row.owner_id),
    deckId: String(row.deck_id),
    kind: String(row.kind),
    content: JSON.parse(String(row.content_json)) as Content,
    explanation: String(row.explanation),
    tags: JSON.parse(String(row.tags_json)) as string[],
    source: noteSourceFrom(row)
  };
}

export async function getNote(
  client: Client,
  session: LearnerSession,
  noteId: string
) {
  const result = await client.execute({
    sql: 'SELECT n.id, n.source_id, n.owner_id, n.deck_id, n.kind, n.content_json, n.status, n.explanation, n.tags_json, n.source_skill_id, n.source_content_version_id, n.source_attempt_id, c.id AS card_id, c.state_json, c.due_at, c.revision, c.suspended, c.scheduler_version, c.parameters_json FROM native_flashcard_notes n LEFT JOIN native_flashcards c ON c.note_id = n.id AND c.owner_id = n.owner_id WHERE n.id = ? AND n.owner_id = ?',
    args: [noteId, session.userId]
  });
  const row = result.rows[0];
  if (!row) throw new FlashcardError('NOT_FOUND');
  return noteFromRow(row);
}

export async function setCardSuspended(
  client: Client,
  session: LearnerSession,
  cardId: string,
  suspended: boolean
): Promise<void> {
  if (typeof suspended !== 'boolean')
    throw new FlashcardError('INVALID_CARD_STATE');
  const card = await client.execute({
    sql: 'SELECT n.status FROM native_flashcards c JOIN native_flashcard_notes n ON n.id = c.note_id AND n.owner_id = c.owner_id WHERE c.id = ? AND c.owner_id = ?',
    args: [cardId, session.userId]
  });
  if (!card.rows[0]) throw new FlashcardError('NOT_FOUND');
  if (card.rows[0].status !== 'approved')
    throw new FlashcardError('NOT_APPROVED');
  const changed = await executeWrite(client, {
    sql: 'UPDATE native_flashcards SET suspended = ? WHERE id = ? AND owner_id = ?',
    args: [suspended ? 1 : 0, cardId, session.userId]
  });
  if (changed.rowsAffected !== 1) throw new FlashcardError('NOT_FOUND');
}

async function replayReview(
  tx: WriteTransaction,
  session: LearnerSession,
  input: ReviewInput
): Promise<ReviewResult | null> {
  const previous = await tx.execute({
    sql: 'SELECT card_id, expected_revision, rating, reviewed_at, result_json FROM native_flashcard_review_events WHERE owner_id = ? AND id = ?',
    args: [session.userId, input.submissionId]
  });
  const row = previous.rows[0];
  if (!row) return null;
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

async function missingReviewCard(
  tx: WriteTransaction,
  session: LearnerSession,
  cardId: string
): Promise<never> {
  const noteId = cardId.startsWith('card:') ? cardId.slice('card:'.length) : '';
  const note = await tx.execute({
    sql: 'SELECT status FROM native_flashcard_notes WHERE id = ? AND owner_id = ?',
    args: [noteId, session.userId]
  });
  const row = note.rows[0];
  if (!row) throw new FlashcardError('NOT_FOUND');
  if (row.status !== 'approved') throw new FlashcardError('NOT_APPROVED');
  throw new FlashcardError('INVALID_CARD_STATE');
}

async function reviewableCard(
  tx: WriteTransaction,
  session: LearnerSession,
  input: ReviewInput
) {
  const found = await tx.execute({
    sql: 'SELECT c.state_json, c.revision, c.suspended, c.scheduler_version, c.parameters_json, n.status FROM native_flashcards c JOIN native_flashcard_notes n ON n.id = c.note_id AND n.owner_id = c.owner_id WHERE c.id = ? AND c.owner_id = ?',
    args: [input.cardId, session.userId]
  });
  const row =
    found.rows[0] ?? (await missingReviewCard(tx, session, input.cardId));
  if (row.status !== 'approved') throw new FlashcardError('NOT_APPROVED');
  if (Number(row.suspended) !== 0) throw new FlashcardError('SUSPENDED');
  if (Number(row.revision) !== input.expectedRevision)
    throw new FlashcardError('STALE_REVIEW');
  return row;
}

async function applyReview(
  tx: WriteTransaction,
  session: LearnerSession,
  input: ReviewInput,
  cardRow: Row
) {
  const cardScheduler = readCardScheduler(
    cardRow.scheduler_version,
    String(cardRow.parameters_json)
  );
  const schedule = await readStudySchedule(tx, session.userId);
  if (
    input.expectedScheduleKey !== undefined &&
    input.expectedScheduleKey !== JSON.stringify(schedule)
  )
    throw new FlashcardError('STALE_REVIEW');
  const effectiveParameters = parametersForSchedule(
    schedule,
    cardScheduler.parameters
  );
  const timezoneRow = await tx.execute({
    sql: 'SELECT timezone FROM learner_preferences WHERE owner_id = ?',
    args: [session.userId]
  });
  const timezone = timezoneRow.rows[0]
    ? String(timezoneRow.rows[0].timezone)
    : 'UTC';
  const reviewedAt = new Date();
  const updated = scheduledCard(
    deterministicScheduler(effectiveParameters).next(
      cardWithId(decodeCard(String(cardRow.state_json)), input.cardId),
      reviewedAt,
      ratings[input.rating]
    ).card,
    reviewedAt,
    timezone
  );
  const result = {
    revision: input.expectedRevision + 1,
    dueAt: updated.due.getTime()
  };
  const changed = await tx.execute({
    sql: 'UPDATE native_flashcards SET state_json = ?, due_at = ?, revision = ?, parameters_json = ? WHERE id = ? AND owner_id = ? AND revision = ?',
    args: [
      encodeCard(updated),
      result.dueAt,
      result.revision,
      JSON.stringify(effectiveParameters),
      input.cardId,
      session.userId,
      input.expectedRevision
    ]
  });
  if (changed.rowsAffected !== 1) throw new FlashcardError('STALE_REVIEW');
  await tx.execute({
    sql: 'INSERT INTO native_flashcard_review_events (id, owner_id, card_id, expected_revision, rating, reviewed_at, scheduler_version, parameters_json, result_json, state_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    args: [
      input.submissionId,
      session.userId,
      input.cardId,
      input.expectedRevision,
      input.rating,
      reviewedAt.getTime(),
      String(cardRow.scheduler_version),
      JSON.stringify(effectiveParameters),
      JSON.stringify(result),
      encodeCard(updated)
    ]
  });
  return result;
}

export async function submitReview(
  client: Client,
  session: LearnerSession,
  input: ReviewInput
) {
  if (
    typeof input.submissionId !== 'string' ||
    !reviewIdPattern.test(input.submissionId)
  ) {
    throw new FlashcardError('INVALID_SUBMISSION_ID');
  }
  const reviewInput = {
    ...input,
    submissionId: input.submissionId.toLowerCase()
  };
  if (!Object.hasOwn(ratings, input.rating))
    throw new FlashcardError('INVALID_RATING');
  const tx = await beginWrite(client);
  try {
    const previous = await replayReview(tx, session, reviewInput);
    if (previous) return previous;
    const cardRow = await reviewableCard(tx, session, reviewInput);
    const result = await applyReview(tx, session, reviewInput, cardRow);
    await tx.commit();
    return { ...result, duplicate: false };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}
