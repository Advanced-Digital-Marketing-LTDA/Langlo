import { createHash, randomUUID } from 'node:crypto';
import type { Client } from '@libsql/client';
import {
  approveNote,
  createNote,
  FlashcardError,
  getNote,
  getStudySchedule,
  ratingIntervals,
  type LearnerSession,
  noteSourceFrom
} from './flashcards';

type Query = Pick<Client, 'execute'>;
export type NoteKind = 'basic' | 'cloze';
export type NoteSummary = {
  id: string;
  sourceId: string;
  kind: NoteKind;
  status: string;
  content: { front?: string; back?: string; text?: string };
  explanation: string;
  tags: string[];
  suspended: boolean | null;
  source: {
    attemptId: string;
    skillId: string;
    contentVersionId: string;
  } | null;
};

/** A note with a stable, opaque source id derived from a fresh random value. */
export function newSourceId(): string {
  return `langlo:v1:${createHash('sha256').update(randomUUID()).digest('hex')}`;
}

/** Every note of one of the caller's decks; a foreign deck reads as missing. */
export async function listNotes(
  client: Query,
  learner: LearnerSession,
  deckId: string
): Promise<{ deck: { id: string; name: string }; notes: NoteSummary[] }> {
  const deck = await client.execute({
    sql: 'SELECT id, name FROM native_flashcard_decks WHERE id = ? AND owner_id = ?',
    args: [deckId, learner.userId]
  });
  if (!deck.rows[0]) throw new FlashcardError('NOT_FOUND');
  const notes = await client.execute({
    sql: 'SELECT n.id, n.source_id, n.kind, n.status, n.content_json, n.explanation, n.tags_json, n.source_skill_id, n.source_content_version_id, n.source_attempt_id, c.suspended FROM native_flashcard_notes n LEFT JOIN native_flashcards c ON c.note_id = n.id AND c.owner_id = n.owner_id WHERE n.deck_id = ? AND n.owner_id = ? ORDER BY n.created_at, n.rowid',
    args: [deckId, learner.userId]
  });
  return {
    deck: { id: String(deck.rows[0].id), name: String(deck.rows[0].name) },
    notes: notes.rows.map((row) => ({
      id: String(row.id),
      sourceId: String(row.source_id),
      kind: String(row.kind) as NoteKind,
      status: String(row.status),
      content: JSON.parse(String(row.content_json)),
      explanation: String(row.explanation),
      tags: JSON.parse(String(row.tags_json)) as string[],
      suspended: row.suspended === null ? null : Boolean(row.suspended),
      source: noteSourceFrom(row)
    }))
  };
}

/** Add a draft note to one of the caller's decks from a submitted form. */
export async function addNoteFromForm(
  client: Client,
  learner: LearnerSession,
  deckId: string,
  form: FormData
) {
  const text = (name: string) => String(form.get(name) ?? '');
  const kind = form.get('kind');
  const id = `note:${randomUUID()}`;
  const sourceId = newSourceId();
  if (kind === 'cloze')
    return createNote(client, learner, {
      id,
      sourceId,
      deckId,
      kind,
      content: { text: text('text') },
      explanation: text('explanation'),
      tags: text('tags')
    });
  if (kind === 'basic')
    return createNote(client, learner, {
      id,
      sourceId,
      deckId,
      kind,
      content: { front: text('front'), back: text('back') },
      explanation: text('explanation'),
      tags: text('tags')
    });
  throw new FlashcardError('INVALID_CONTENT');
}

export async function searchNotes(
  client: Query,
  learner: LearnerSession,
  search: string
) {
  const query = search.trim();
  if (!query) return [];
  if (query.length > 100) throw new FlashcardError('INVALID_SEARCH');
  const result = await client.execute({
    sql: `SELECT n.id, n.kind, n.status, n.content_json, n.tags_json,
        n.explanation,
        d.id AS deck_id, d.name AS deck_name
      FROM native_flashcard_notes n
      JOIN native_flashcard_decks d ON d.id = n.deck_id AND d.owner_id = n.owner_id
      WHERE n.owner_id = ? ORDER BY n.created_at, n.rowid`,
    args: [learner.userId]
  });
  const searchTerm = query.toLocaleLowerCase('en');
  // SQLite's lower() only folds ASCII, so match Unicode learner content here.
  return result.rows
    .filter((row) =>
      [
        String(row.content_json),
        String(row.explanation),
        String(row.tags_json),
        String(row.deck_name)
      ].some((value) => value.toLocaleLowerCase('en').includes(searchTerm))
    )
    .map((row) => ({
      id: String(row.id),
      kind: String(row.kind) as NoteKind,
      status: String(row.status),
      content: JSON.parse(String(row.content_json)) as NoteSummary['content'],
      tags: JSON.parse(String(row.tags_json)) as string[],
      deck: { id: String(row.deck_id), name: String(row.deck_name) }
    }));
}

/** How many approved, unsuspended cards are due now, however many are listed. */
export async function countDueCards(
  client: Query,
  learner: LearnerSession,
  now: number = Date.now()
): Promise<number> {
  const result = await client.execute({
    sql: `SELECT count(*) AS total FROM native_flashcards c
      JOIN native_flashcard_notes n ON n.id = c.note_id AND n.owner_id = c.owner_id
      WHERE c.owner_id = ? AND c.suspended = 0 AND n.status = 'approved' AND c.due_at <= ?`,
    args: [learner.userId, now]
  });
  return Number(result.rows[0].total);
}

/**
 * Approve one of the caller's draft notes. Approving a note that is already
 * approved (a double click, a second tab) succeeds; a missing or foreign note
 * is still not found.
 */
export async function approveOwnNote(
  client: Client,
  learner: LearnerSession,
  noteId: string
): Promise<void> {
  try {
    await approveNote(client, learner, noteId);
  } catch (thrown) {
    if (thrown instanceof FlashcardError && thrown.code === 'NOT_FOUND') {
      const approved = await client.execute({
        sql: "SELECT 1 FROM native_flashcard_notes WHERE id = ? AND owner_id = ? AND status = 'approved'",
        args: [noteId, learner.userId]
      });
      if (approved.rows[0]) return;
    }
    throw thrown;
  }
}

/** Approved, unsuspended cards that are due now, oldest first. */
export async function listDueCards(
  client: Client,
  learner: LearnerSession,
  now: number = Date.now(),
  limit = 20
) {
  const result = await client.execute({
    sql: `SELECT c.id, c.revision, n.id AS note_id, n.kind, n.content_json, d.name AS deck_name
      FROM native_flashcards c
      JOIN native_flashcard_notes n ON n.id = c.note_id AND n.owner_id = c.owner_id
      JOIN native_flashcard_decks d ON d.id = n.deck_id AND d.owner_id = n.owner_id
      WHERE c.owner_id = ? AND c.suspended = 0 AND n.status = 'approved' AND c.due_at <= ?
      ORDER BY c.due_at, c.id LIMIT ?`,
    args: [learner.userId, now, limit]
  });
  const schedule = await getStudySchedule(client, learner);
  const reviewedAt = new Date(now);
  return Promise.all(
    result.rows.map(async (row) => {
      const note = await getNote(client, learner, String(row.note_id));
      if (!note.card) throw new FlashcardError('INVALID_CARD_STATE');
      return {
        id: String(row.id),
        revision: Number(row.revision),
        kind: String(row.kind) as NoteKind,
        deck: String(row.deck_name),
        content: JSON.parse(String(row.content_json)) as NoteSummary['content'],
        explanation: note.explanation,
        intervals: ratingIntervals(
          note.card.state,
          note.card.id,
          note.card.parameters,
          schedule,
          reviewedAt
        )
      };
    })
  );
}

/** Quote an Anki text-import field when it holds a tab, newline or quote. */
function ankiField(value: string): string {
  return /[\t\n\r"]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * The deck's approved notes as Anki tab-separated text. Each row carries the
 * note's persisted source id as its GUID, so Anki tells notes with the same
 * first field apart and a re-export updates a note instead of duplicating it.
 * Drafts and rejected notes are never exported.
 */
export async function exportDeckForAnki(
  client: Query,
  learner: LearnerSession,
  deckId: string
): Promise<string> {
  const { deck, notes } = await listNotes(client, learner, deckId);
  const lines = [
    '#separator:tab',
    '#html:false',
    '#guid column:1',
    '#notetype column:2',
    '#deck column:3'
  ];
  for (const note of notes) {
    if (note.status !== 'approved') continue;
    const fields =
      note.kind === 'basic'
        ? [
            note.sourceId,
            'Basic',
            deck.name,
            note.content.front ?? '',
            note.content.back ?? ''
          ]
        : [note.sourceId, 'Cloze', deck.name, note.content.text ?? '', ''];
    lines.push(fields.map(ankiField).join('\t'));
  }
  return `${lines.join('\n')}\n`;
}
