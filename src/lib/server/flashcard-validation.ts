import type { NoteSource } from './flashcards';

export const maxCardTextLength = 4096;
const maxExplanationLength = 1000;
const maxSourceFieldLength = 512;
const sourceIdPattern = /^langlo:v1:[0-9a-f]{64}$/u;
export function normalizeTags(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  const list = typeof value === 'string' ? value.split(',') : value;
  if (!Array.isArray(list) || list.length > 20)
    throw new FlashcardError('INVALID_TAGS');
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const value_ of list) {
    const tag = normalizeTag(value_);
    if (!tag) continue;
    const key = tag.toLocaleLowerCase('en');
    if (!seen.has(key)) tags.push(tag);
    seen.add(key);
  }
  return tags;
}

function normalizeTag(value: unknown): string | null {
  if (typeof value !== 'string') throw new FlashcardError('INVALID_TAGS');
  const tag = value.trim();
  if (!tag) return null;
  if (exceedsCodePointLimit(tag, 64) || tag.includes('\0'))
    throw new FlashcardError('INVALID_TAGS');
  return tag;
}

export function exceedsCodePointLimit(value: string, limit: number): boolean {
  const codePoints = value[Symbol.iterator]();
  let count = 0;
  while (!codePoints.next().done) {
    if (++count > limit) return true;
  }
  return false;
}

export class FlashcardError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
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

export function validateContent(kind: unknown, content: unknown): void {
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

export function isNonEmptyBoundedText(
  value: unknown,
  limit: number
): value is string {
  if (typeof value !== 'string') return false;
  if (value.trim() === '') return false;
  return isBoundedText(value, limit);
}

export function isSourceId(value: unknown): value is string {
  return typeof value === 'string' && sourceIdPattern.test(value);
}

/** The optional short explanation shown beside a generated mistake card. */
export function validateExplanation(value: unknown): string {
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
export function validateNoteSource(value: unknown): NoteSource | null {
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
