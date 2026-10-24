import { createHash, randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import type { Client } from '@libsql/client';
import { containsTerm, splitSentences } from '../library-text';
import { createSourceId } from './db/source-id';
import { createNote, type LearnerSession } from './flashcards';
import { StudyError } from './study-error';

export const LIBRARY_LANGUAGES = ['fr', 'de', 'en', 'pt'] as const;
export type LibraryLanguage = (typeof LIBRARY_LANGUAGES)[number];

const maxFileBytes = 10 * 1024 * 1024;
const maxTextLength = 1_000_000;
const fileTypes = new Set(['txt', 'pdf', 'docx', 'epub']);
let activeParsers = 0;
const maxActiveParsers = 2;

export type ParsedLibraryDocument = {
  title: string;
  language: LibraryLanguage;
  content: string;
};

export type LibraryDocument = {
  id: string;
  title: string;
  language: LibraryLanguage;
  content: string;
  sentenceCount: number;
  progressIndex: number;
  createdAt: number;
};

function documentTitle(name: string): string {
  const basename = name.split(/[\\/]/u).at(-1) ?? '';
  const title = basename.replace(/\.[^.]*$/u, '').trim();
  if (!title || title.length > 160 || title.includes('\0'))
    throw new StudyError('INVALID_LIBRARY_TITLE');
  return title;
}

function normalizeDocumentText(value: string): string {
  const content = value.replace(/\r\n?/gu, '\n').trim();
  if (
    !content ||
    content.length > maxTextLength ||
    content.includes('\0') ||
    !/[\p{L}\p{N}]/u.test(content)
  )
    throw new StudyError('INVALID_LIBRARY_DOCUMENT');
  return content;
}

function extractOfficeText(buffer: ArrayBuffer, extension: string) {
  if (activeParsers >= maxActiveParsers)
    return Promise.reject(new StudyError('LIBRARY_PARSE_BUSY'));
  activeParsers += 1;
  let worker: Worker;
  try {
    worker = new Worker(
      resolve(process.cwd(), 'scripts/library-parser-worker.mjs'),
      {
        workerData: { buffer, extension },
        transferList: [buffer],
        resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 }
      }
    );
  } catch (error) {
    activeParsers -= 1;
    throw error;
  }
  return new Promise<string>((resolveText, reject) => {
    // shortcut: allow two parser workers, raise after deployment memory is measured
    const timeout = setTimeout(() => {
      void worker.terminate();
      reject(new StudyError('LIBRARY_PARSE_TIMEOUT'));
    }, 20_000);
    worker.once('message', (result: { text?: string; code?: string }) => {
      clearTimeout(timeout);
      void worker.terminate();
      if (result.code) reject(new StudyError(result.code));
      else if (typeof result.text === 'string') resolveText(result.text);
      else reject(new StudyError('INVALID_LIBRARY_DOCUMENT'));
    });
    worker.once('error', () => {
      clearTimeout(timeout);
      reject(new StudyError('INVALID_LIBRARY_DOCUMENT'));
    });
    worker.once('exit', (code) => {
      activeParsers -= 1;
      clearTimeout(timeout);
      if (code !== 0) reject(new StudyError('INVALID_LIBRARY_DOCUMENT'));
    });
  });
}

export async function parseLibraryDocument(
  file: File,
  language: unknown
): Promise<ParsedLibraryDocument> {
  if (
    typeof language !== 'string' ||
    !LIBRARY_LANGUAGES.includes(language as LibraryLanguage)
  )
    throw new StudyError('INVALID_LIBRARY_LANGUAGE');
  if (file.size > maxFileBytes) throw new StudyError('LIBRARY_FILE_TOO_LARGE');

  const extension = file.name.split('.').at(-1)?.toLowerCase() ?? '';
  if (!fileTypes.has(extension)) throw new StudyError('INVALID_LIBRARY_FILE');
  const title = documentTitle(file.name);

  let content: string;
  try {
    const buffer = await file.arrayBuffer();
    content =
      extension === 'txt'
        ? new TextDecoder('utf-8', { fatal: true }).decode(buffer)
        : await extractOfficeText(buffer, extension);
    if (extension === 'txt' && /^\s*%PDF-/u.test(content))
      throw new StudyError('INVALID_LIBRARY_DOCUMENT');
  } catch (error) {
    if (error instanceof StudyError) throw error;
    throw new StudyError('INVALID_LIBRARY_DOCUMENT');
  }

  return {
    title,
    language: language as LibraryLanguage,
    content: normalizeDocumentText(content)
  };
}

function validTitle(title: unknown): title is string {
  return (
    typeof title === 'string' &&
    Boolean(title.trim()) &&
    title.length <= 160 &&
    !title.includes('\0')
  );
}

function documentFromRow(row: Record<string, unknown>): LibraryDocument {
  return {
    id: String(row.id),
    title: String(row.title),
    language: String(row.language) as LibraryLanguage,
    content: String(row.content),
    sentenceCount: Number(row.sentence_count),
    progressIndex: Number(row.progress_index),
    createdAt: Number(row.created_at)
  };
}

export async function createLibraryDocument(
  client: Client,
  learner: LearnerSession,
  input: ParsedLibraryDocument & { id: string }
) {
  if (!input.id || input.id.length > 160 || input.id.includes('\0'))
    throw new StudyError('INVALID_LIBRARY_DOCUMENT');
  if (!validTitle(input.title)) throw new StudyError('INVALID_LIBRARY_TITLE');
  if (!LIBRARY_LANGUAGES.includes(input.language))
    throw new StudyError('INVALID_LIBRARY_LANGUAGE');
  const content = normalizeDocumentText(input.content);
  const sentenceCount = splitSentences(content).length;
  await client.execute({
    sql: 'INSERT INTO library_documents (id, owner_id, title, language, content, sentence_count) VALUES (?, ?, ?, ?, ?, ?)',
    args: [
      input.id,
      learner.userId,
      input.title.trim(),
      input.language,
      content,
      sentenceCount
    ]
  });
}

export async function listLibraryDocuments(
  client: Client,
  learner: LearnerSession
) {
  const result = await client.execute({
    sql: 'SELECT id, title, language, sentence_count, progress_index, created_at FROM library_documents WHERE owner_id = ? ORDER BY created_at DESC, id',
    args: [learner.userId]
  });
  return result.rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    language: String(row.language) as LibraryLanguage,
    sentenceCount: Number(row.sentence_count),
    progressIndex: Number(row.progress_index),
    createdAt: Number(row.created_at)
  }));
}

export async function getLibraryDocument(
  client: Client,
  learner: LearnerSession,
  id: string
) {
  const result = await client.execute({
    sql: 'SELECT id, title, language, content, sentence_count, progress_index, created_at FROM library_documents WHERE id = ? AND owner_id = ?',
    args: [id, learner.userId]
  });
  const row = result.rows[0];
  if (!row) throw new StudyError('NOT_FOUND');
  return documentFromRow(row);
}

export async function renameLibraryDocument(
  client: Client,
  learner: LearnerSession,
  id: string,
  title: unknown
) {
  if (!validTitle(title)) throw new StudyError('INVALID_LIBRARY_TITLE');
  const result = await client.execute({
    sql: 'UPDATE library_documents SET title = ? WHERE id = ? AND owner_id = ?',
    args: [title.trim(), id, learner.userId]
  });
  if (result.rowsAffected !== 1) throw new StudyError('NOT_FOUND');
}

export async function updateLibraryProgress(
  client: Client,
  learner: LearnerSession,
  id: string,
  progressIndex: unknown
) {
  const document = await getLibraryDocument(client, learner, id);
  if (
    typeof progressIndex !== 'number' ||
    !Number.isInteger(progressIndex) ||
    Number(progressIndex) < 0 ||
    Number(progressIndex) > document.sentenceCount
  )
    throw new StudyError('INVALID_LIBRARY_PROGRESS');
  const result = await client.execute({
    sql: 'UPDATE library_documents SET progress_index = ? WHERE id = ? AND owner_id = ?',
    args: [Number(progressIndex), id, learner.userId]
  });
  if (result.rowsAffected !== 1) throw new StudyError('NOT_FOUND');
}

export async function deleteLibraryDocument(
  client: Client,
  learner: LearnerSession,
  id: string
) {
  const result = await client.execute({
    sql: 'DELETE FROM library_documents WHERE id = ? AND owner_id = ?',
    args: [id, learner.userId]
  });
  if (result.rowsAffected !== 1) throw new StudyError('NOT_FOUND');
}

export async function listLibraryVocabulary(
  client: Client,
  learner: LearnerSession,
  language: LibraryLanguage
) {
  const result = await client.execute({
    sql: `SELECT n.content_json FROM native_flashcard_notes n
      JOIN native_flashcard_decks d ON d.id = n.deck_id AND d.owner_id = n.owner_id
      WHERE n.owner_id = ? AND d.language = ? AND n.status IN ('draft', 'approved')
        AND EXISTS (SELECT 1 FROM json_each(n.tags_json) AS tag WHERE tag.value = 'library-vocabulary')
      ORDER BY n.created_at DESC, n.id`,
    args: [learner.userId, language]
  });
  const terms = new Map<string, string>();
  for (const row of result.rows) {
    const content = JSON.parse(String(row.content_json)) as { front?: unknown };
    if (typeof content.front !== 'string') continue;
    const term = content.front.trim();
    if (term) terms.set(term.toLocaleLowerCase(), term);
  }
  return [...terms.values()];
}

export async function libraryTargetLanguage(
  client: Client,
  learner: LearnerSession,
  language: LibraryLanguage
): Promise<'en' | 'pt'> {
  const matching = await client.execute({
    sql: 'SELECT explanation_language FROM enrollments WHERE owner_id = ? AND language = ?',
    args: [learner.userId, language]
  });
  if (matching.rows[0])
    return String(matching.rows[0].explanation_language) as 'en' | 'pt';
  const first = await client.execute({
    sql: 'SELECT explanation_language FROM enrollments WHERE owner_id = ? ORDER BY created_at, id LIMIT 1',
    args: [learner.userId]
  });
  return first.rows[0]
    ? (String(first.rows[0].explanation_language) as 'en' | 'pt')
    : 'en';
}

export async function saveLibraryVocabulary(
  client: Client,
  learner: LearnerSession,
  input: {
    documentId: string;
    deckId: string;
    term: unknown;
    definition: unknown;
  }
) {
  const document = await getLibraryDocument(client, learner, input.documentId);
  if (
    typeof input.term !== 'string' ||
    !input.term.trim() ||
    input.term.length > 256 ||
    input.term.includes('\0')
  )
    throw new StudyError('INVALID_LIBRARY_TERM');
  const term = input.term.trim();
  if (!containsTerm(document.content, term))
    throw new StudyError('INVALID_LIBRARY_TERM');
  if (
    typeof input.definition !== 'string' ||
    !input.definition.trim() ||
    input.definition.length > 4096 ||
    input.definition.includes('\0')
  )
    throw new StudyError('INVALID_LIBRARY_DEFINITION');
  const deck = await client.execute({
    sql: 'SELECT language FROM native_flashcard_decks WHERE id = ? AND owner_id = ?',
    args: [input.deckId, learner.userId]
  });
  if (!deck.rows[0]) throw new StudyError('NOT_FOUND');
  if (deck.rows[0].language !== document.language)
    throw new StudyError('INVALID_LIBRARY_DECK');

  const definition = input.definition.trim();
  const sourceId = createSourceId({
    ownerId: learner.userId,
    language: document.language,
    skillId: 'library-vocabulary',
    canonicalMistake: createHash('sha256')
      .update(
        JSON.stringify([
          input.deckId,
          term.toLocaleLowerCase(),
          definition.toLocaleLowerCase()
        ])
      )
      .digest('hex')
  });
  const findExisting = async () => {
    const result = await client.execute({
      sql: 'SELECT id, status, deck_id, kind, content_json, tags_json FROM native_flashcard_notes WHERE owner_id = ? AND source_id = ?',
      args: [learner.userId, sourceId]
    });
    const row = result.rows[0];
    if (row) {
      const content = JSON.parse(String(row.content_json)) as {
        front?: string;
        back?: string;
      };
      const tags = JSON.parse(String(row.tags_json)) as string[];
      if (
        row.deck_id !== input.deckId ||
        row.kind !== 'basic' ||
        content.front?.trim().toLocaleLowerCase() !==
          term.toLocaleLowerCase() ||
        content.back?.trim().toLocaleLowerCase() !==
          definition.toLocaleLowerCase() ||
        !tags.includes('library-vocabulary')
      )
        throw new StudyError('LIBRARY_VOCABULARY_CHANGED');
    }
    return row ? { id: String(row.id), status: String(row.status) } : null;
  };
  const existing = await findExisting();
  if (existing) return existing;

  try {
    return await createNote(client, learner, {
      id: randomUUID(),
      sourceId,
      deckId: input.deckId,
      kind: 'basic',
      content: { front: term, back: definition },
      tags: ['library-vocabulary']
    });
  } catch (error) {
    if ((error as { code?: string }).code?.startsWith('SQLITE_CONSTRAINT')) {
      const winner = await findExisting();
      if (winner) return winner;
    }
    throw error;
  }
}
