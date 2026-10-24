export const libraryMaxFileBytes = 10_000_000;
export const libraryFileTooLargeMessage = `Choose a file of ${libraryMaxFileBytes / 1_000_000} MB or smaller.`;

export function splitSentences(text: string): string[] {
  return Array.from(
    new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text),
    ({ segment }) => segment.trim()
  ).filter(Boolean);
}

function termPattern(term: string, flags: string) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  // nosemgrep: the term is escaped above and the pattern has no nested quantifiers.
  return new RegExp(
    `(^|[^\\p{L}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{N}])`,
    flags
  );
}

export function containsTerm(text: string, term: string): boolean {
  const normalized = term.trim();
  return Boolean(normalized) && termPattern(normalized, 'iu').test(text);
}

export function highlightSavedTerms(text: string, terms: string[]) {
  const ranges: { start: number; end: number }[] = [];
  for (const term of [...new Set(terms)].sort((a, b) => b.length - a.length)) {
    const pattern = termPattern(term, 'giu');
    for (const match of text.matchAll(pattern)) {
      const start = (match.index ?? 0) + match[1].length;
      ranges.push({ start, end: start + match[2].length });
    }
  }
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);

  const parts: { text: string; saved: boolean }[] = [];
  let offset = 0;
  for (const range of ranges) {
    if (range.start < offset) continue;
    if (range.start > offset)
      parts.push({ text: text.slice(offset, range.start), saved: false });
    parts.push({ text: text.slice(range.start, range.end), saved: true });
    offset = range.end;
  }
  if (offset < text.length || !parts.length)
    parts.push({ text: text.slice(offset), saved: false });
  return parts;
}

/** Collapse every run of whitespace to one space. */
export const collapseWhitespace = (text: string) =>
  text.replace(/\s+/gu, ' ').trim();

/**
 * Split a document into reading pages of at most `maxChars` characters. Pages
 * end at a paragraph break when they can; a paragraph longer than a page is
 * cut at sentence boundaries, and a sentence longer than a page is cut hard.
 */
export function paginateText(text: string, maxChars: number): string[] {
  const pages: string[] = [];
  let page: string[] = [];
  let length = 0;
  const flush = () => {
    if (page.length) pages.push(page.join('\n'));
    page = [];
    length = 0;
  };
  const add = (piece: string) => {
    if (length && length + piece.length + 1 > maxChars) flush();
    page.push(piece);
    length += piece.length + 1;
  };
  for (const paragraph of text.split(/\n+/u)) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    if (trimmed.length <= maxChars) {
      add(trimmed);
      continue;
    }
    let chunk = '';
    for (const sentence of splitSentences(trimmed)) {
      if (chunk && chunk.length + sentence.length + 1 > maxChars) {
        add(chunk);
        chunk = '';
      }
      if (sentence.length > maxChars) {
        for (let at = 0; at < sentence.length; at += maxChars)
          add(sentence.slice(at, at + maxChars));
      } else chunk = chunk ? `${chunk} ${sentence}` : sentence;
    }
    if (chunk) add(chunk);
  }
  flush();
  return pages;
}

/**
 * Find where `selected` sits in `pageText`. Both are compared with collapsed
 * whitespace; when the text occurs more than once, the occurrence nearest to
 * `approxStart` (a character offset into the collapsed page text) wins.
 */
export function locateSelection(
  pageText: string,
  selected: string,
  approxStart: number
): { text: string; start: number; end: number } | null {
  const page = collapseWhitespace(pageText);
  const text = collapseWhitespace(selected);
  if (!text) return null;
  let best = -1;
  for (let at = page.indexOf(text); at !== -1; at = page.indexOf(text, at + 1))
    if (
      best === -1 ||
      Math.abs(at - approxStart) < Math.abs(best - approxStart)
    )
      best = at;
  return best === -1 ? null : { text, start: best, end: best + text.length };
}

export type SentenceContext = {
  sentence: string;
  previousSentence: string;
  nextSentence: string;
};

/** The sentence holding a selection, with the sentences on either side. */
export function sentenceContext(
  pageText: string,
  start: number,
  end: number,
  language: string
): SentenceContext {
  const page = collapseWhitespace(pageText);
  const sentences = Array.from(
    new Intl.Segmenter(language, { granularity: 'sentence' }).segment(page),
    ({ segment, index }) => ({
      text: segment.trim(),
      start: index,
      end: index + segment.length
    })
  ).filter(({ text }) => text);
  let at = sentences.findIndex((item) => start < item.end);
  if (at === -1) at = sentences.length - 1;
  const spansBoundary = sentences[at] && end > sentences[at].end;
  return {
    sentence: spansBoundary
      ? sentences
          .filter((item) => item.start < end && item.end > start)
          .map((item) => item.text)
          .join(' ')
      : (sentences[at]?.text ?? ''),
    previousSentence: sentences[at - 1]?.text ?? '',
    nextSentence: sentences[at + 1]?.text ?? ''
  };
}

const isWordChar = (char: string | undefined) =>
  char !== undefined && /[\p{L}\p{N}]/u.test(char);

/**
 * Widen a selection to whole words and drop punctuation at its edges, so a
 * drag that starts or ends inside a word still names whole words.
 */
export function snapToWords(
  page: string,
  start: number,
  end: number
): { text: string; start: number; end: number } | null {
  let from = start;
  let to = end;
  while (from < to && !isWordChar(page[from])) from += 1;
  while (to > from && !isWordChar(page[to - 1])) to -= 1;
  if (from >= to) return null;
  while (from > 0 && isWordChar(page[from - 1])) from -= 1;
  while (to < page.length && isWordChar(page[to])) to += 1;
  return { text: page.slice(from, to), start: from, end: to };
}
