/** The Review tab's choice for flashcards whose deck and source have no language. */
export const UNASSIGNED_LANGUAGE = 'unassigned';

/** The `language` query value for a due-card language group. */
export function reviewLanguageParam(language: string | null): string {
  return language ?? UNASSIGNED_LANGUAGE;
}
