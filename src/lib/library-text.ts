export function splitSentences(text: string): string[] {
  return Array.from(
    new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text),
    ({ segment }) => segment.trim()
  ).filter(Boolean);
}

function termPattern(term: string, flags: string) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
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
