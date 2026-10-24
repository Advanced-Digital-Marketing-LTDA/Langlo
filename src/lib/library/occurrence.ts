/** Every index at which `needle` starts in `haystack`, overlaps included. */
function occurrences(haystack: string, needle: string): number[] {
  const starts: number[] = [];
  for (
    let at = haystack.indexOf(needle);
    at !== -1;
    at = haystack.indexOf(needle, at + 1)
  )
    starts.push(at);
  return starts;
}

/**
 * Where a selection of `text` most likely starts in `page`. `before` is the
 * text ahead of the selection as the DOM stores it, without the separators
 * `page` has between blocks, so only the number of earlier matches is trusted,
 * never its length.
 */
export function selectionStartHint(
  page: string,
  before: string,
  text: string
): number {
  const starts = occurrences(page, text);
  const earlier = occurrences(before, text).length;
  return starts[Math.min(earlier, starts.length - 1)] ?? 0;
}
