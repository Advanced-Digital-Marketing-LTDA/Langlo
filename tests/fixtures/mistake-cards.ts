import type { Client } from '@libsql/client';
import { openFixtureDatabase } from '../../src/lib/server/db/connection';
import { fixture, testSession } from './flashcards';

export const learner = testSession('learner-a');
export const other = testSession('learner-b');
export const attemptId = 'attempt-a';

/** Seed a checked practice mistake with a lesson, ready for draft generation. */
export async function setupMistakeCardFixture() {
  const target = await fixture();
  const db = await openFixtureDatabase(target);
  await db.client.execute(
    "UPDATE questions SET prompt = 'Je ___ étudiant.', answer = 'suis' WHERE id = 'question-1'"
  );
  await db.client.execute({
    sql: "INSERT INTO lessons (content_version_id, skill_id, language, title, explanation, examples, refs, fingerprint) VALUES ('content-v1', 'fr-articles', 'fr', 'Le présent', ?, '[]', '[]', ?)",
    args: [
      'Use the present tense of être: je suis. The blank needs the conjugated form, not the infinitive.',
      'a'.repeat(64)
    ]
  });
  return { db, target };
}

export async function noteCounts(client: Client) {
  const result = await client.batch(
    [
      'SELECT count(*) AS total FROM native_flashcard_notes',
      'SELECT count(*) AS total FROM native_flashcards',
      'SELECT count(*) AS total FROM native_flashcard_review_events'
    ],
    'read'
  );
  return result.map((query) => Number(query.rows[0].total));
}
