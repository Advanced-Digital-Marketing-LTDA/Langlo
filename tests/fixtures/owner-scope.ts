import type { Client } from '@libsql/client';

// Every owner-scoped table; forged calls must leave all of them byte-identical.
export const privateTables = [
  'study_sessions',
  'attempts',
  'evaluations',
  'skill_evidence',
  'content_reports',
  'native_flashcard_decks',
  'native_flashcard_notes',
  'native_flashcards',
  'native_flashcard_review_events'
] as const;

/** Ordered snapshot of all private rows, used as the zero-write oracle. */
export async function privateState(client: Pick<Client, 'batch'>) {
  const results = await client.batch(
    privateTables.map(
      (table) => `SELECT * FROM ${table} ORDER BY owner_id, id`
    ),
    'read'
  );
  return Object.fromEntries(
    privateTables.map((table, index) => [
      table,
      results[index].rows.map((row) => ({ ...row }))
    ])
  );
}
