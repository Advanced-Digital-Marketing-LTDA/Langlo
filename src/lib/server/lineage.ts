// Identity of a question across lesson versions. A question keeps its lineage
// key while it keeps its meaning; a changed or new question gets a fresh key.
// Rows imported before lineage keys existed carry none, and their key is the
// question's number after the version prefix (`q03` in `skill@2:q03`), so
// existing evidence keeps counting exactly as before.

/** The question id without its `<content version id>:` prefix. */
export function legacyLineageKey(
  contentVersionId: string,
  questionId: string
): string {
  const prefix = `${contentVersionId}:`;
  return questionId.startsWith(prefix)
    ? questionId.slice(prefix.length)
    : questionId;
}

/** The stored lineage key, or the number-based key of a pre-lineage row. */
export function effectiveLineageKey(row: {
  lineageKey: string | null;
  contentVersionId: string;
  questionId: string;
}): string {
  return (
    row.lineageKey ?? legacyLineageKey(row.contentVersionId, row.questionId)
  );
}
