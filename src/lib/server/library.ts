import { createHash, randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import type { Client } from '@libsql/client';
import { containsTerm, splitSentences } from '../library-text';
import { createSourceId } from './db/source-id';
import { createNote, executeWrite, type LearnerSession } from './flashcards';
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
  if (content.length > maxTextLength)
    throw new StudyError('LIBRARY_CONTENT_TOO_LARGE');
  if (!content || content.includes('\0') || !/[\p{L}\p{N}]/u.test(content))
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
    worker.once('exit', () => {
      activeParsers -= 1;
      clearTimeout(timeout);
      reject(new StudyError('INVALID_LIBRARY_DOCUMENT'));
    });
  });
}

function libraryLanguage(language: unknown): LibraryLanguage {
  if (
    typeof language !== 'string' ||
    !LIBRARY_LANGUAGES.includes(language as LibraryLanguage)
  )
    throw new StudyError('INVALID_LIBRARY_LANGUAGE');
  return language as LibraryLanguage;
}

function libraryFileExtension(file: File): string {
  if (file.size > maxFileBytes) throw new StudyError('LIBRARY_FILE_TOO_LARGE');
  const extension = file.name.split('.').at(-1)?.toLowerCase() ?? '';
  if (!fileTypes.has(extension)) throw new StudyError('INVALID_LIBRARY_FILE');
  return extension;
}

async function decodeDocument(buffer: ArrayBuffer, extension: string) {
  if (extension !== 'txt') return extractOfficeText(buffer, extension);
  const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  if (/^\s*%PDF-/u.test(content))
    throw new StudyError('INVALID_LIBRARY_DOCUMENT');
  return content;
}

async function readDocumentText(file: File, extension: string) {
  try {
    return await decodeDocument(await file.arrayBuffer(), extension);
  } catch (error) {
    if (error instanceof StudyError) throw error;
    throw new StudyError('INVALID_LIBRARY_DOCUMENT');
  }
}

export async function parseLibraryDocument(
  file: File,
  language: unknown
): Promise<ParsedLibraryDocument> {
  const documentLanguage = libraryLanguage(language);
  const extension = libraryFileExtension(file);
  const title = documentTitle(file.name);
  const content = await readDocumentText(file, extension);
  return {
    title,
    language: documentLanguage,
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
  await executeWrite(client, {
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
  const result = await executeWrite(client, {
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
  const result = await executeWrite(client, {
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
  const result = await executeWrite(client, {
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

type VocabularyEntry = { deckId: string; term: string; definition: string };

function filledText(value: unknown, limit: number): value is string {
  return (
    typeof value === 'string' &&
    Boolean(value.trim()) &&
    value.length <= limit &&
    !value.includes('\0')
  );
}

function libraryTerm(value: unknown, content: string): string {
  if (!filledText(value, 256)) throw new StudyError('INVALID_LIBRARY_TERM');
  const term = value.trim();
  if (!containsTerm(content, term))
    throw new StudyError('INVALID_LIBRARY_TERM');
  return term;
}

function libraryDefinition(value: unknown): string {
  if (!filledText(value, 4096))
    throw new StudyError('INVALID_LIBRARY_DEFINITION');
  return value.trim();
}

async function assertDeckMatches(
  client: Client,
  learner: LearnerSession,
  deckId: string,
  language: LibraryLanguage
) {
  const deck = await client.execute({
    sql: 'SELECT language FROM native_flashcard_decks WHERE id = ? AND owner_id = ?',
    args: [deckId, learner.userId]
  });
  if (!deck.rows[0]) throw new StudyError('NOT_FOUND');
  if (deck.rows[0].language !== language)
    throw new StudyError('INVALID_LIBRARY_DECK');
}

function vocabularySourceId(
  learner: LearnerSession,
  language: LibraryLanguage,
  entry: VocabularyEntry
) {
  return createSourceId({
    ownerId: learner.userId,
    language,
    skillId: 'library-vocabulary',
    canonicalMistake: createHash('sha256')
      .update(
        JSON.stringify([
          entry.deckId,
          entry.term.toLocaleLowerCase(),
          entry.definition.toLocaleLowerCase()
        ])
      )
      .digest('hex')
  });
}

const sameText = (actual: string | undefined, expected: string) =>
  actual?.trim().toLocaleLowerCase() === expected.toLocaleLowerCase();

function vocabularyRowChanged(
  row: Record<string, unknown>,
  entry: VocabularyEntry
): boolean {
  const content = JSON.parse(String(row.content_json)) as {
    front?: string;
    back?: string;
  };
  const tags = JSON.parse(String(row.tags_json)) as string[];
  if (row.deck_id !== entry.deckId || row.kind !== 'basic') return true;
  if (
    !sameText(content.front, entry.term) ||
    !sameText(content.back, entry.definition)
  )
    return true;
  return !tags.includes('library-vocabulary');
}

async function findExistingVocabulary(
  client: Client,
  learner: LearnerSession,
  sourceId: string,
  entry: VocabularyEntry
) {
  const result = await client.execute({
    sql: 'SELECT id, status, deck_id, kind, content_json, tags_json FROM native_flashcard_notes WHERE owner_id = ? AND source_id = ?',
    args: [learner.userId, sourceId]
  });
  const row = result.rows[0];
  if (!row) return null;
  if (vocabularyRowChanged(row, entry))
    throw new StudyError('LIBRARY_VOCABULARY_CHANGED');
  return { id: String(row.id), status: String(row.status) };
}

const isConstraintError = (error: unknown) =>
  (error as { code?: string }).code?.startsWith('SQLITE_CONSTRAINT');

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
  const term = libraryTerm(input.term, document.content);
  const definition = libraryDefinition(input.definition);
  await assertDeckMatches(client, learner, input.deckId, document.language);

  const entry = { deckId: input.deckId, term, definition };
  const sourceId = vocabularySourceId(learner, document.language, entry);
  const existing = await findExistingVocabulary(
    client,
    learner,
    sourceId,
    entry
  );
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
    if (isConstraintError(error)) {
      const winner = await findExistingVocabulary(
        client,
        learner,
        sourceId,
        entry
      );
      if (winner) return winner;
    }
    throw error;
  }
}
