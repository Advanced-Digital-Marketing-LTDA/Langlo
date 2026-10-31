import { afterEach, describe, expect, it } from 'vitest';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { importContent } from '../src/lib/server/content-import';
import { loadProgress } from '../src/lib/server/progress';
import { recordAttempt } from '../src/lib/server/study';
import { approveNote, submitReview } from '../src/lib/server/flashcards';
import {
  disposeFlashcardFixtures,
  fixture,
  seedBasicNote,
  testSession
} from './fixtures/flashcards';
import { approvedPackage } from './fixtures/content-package';

// LANGLO-119: rating native flashcards never changes grammar progress.

const grammarTables = [
  'study_sessions',
  'attempts',
  'evaluations',
  'skill_evidence',
  'grammar_retention_schedules',
  'grammar_retention_events'
];

afterEach(disposeFlashcardFixtures);

describe('native reviews and grammar progress', () => {
  it('leaves grammar mastery and its records unchanged for every rating', async () => {
    const learner = testSession('learner-a');
    const { client, close } = await openFixtureDatabase(await fixture());
    try {
      await importContent(client, approvedPackage());
      await client.execute(
        "INSERT INTO study_sessions (id, owner_id, enrollment_id, language, mode) VALUES ('separation-session', 'learner-a', 'enrollment-a', 'fr', 'practice')"
      );
      await recordAttempt(client, learner, {
        studySessionId: 'separation-session',
        questionId: 'fr-a1-001@1:q2',
        submissionKey: 'separation-answer',
        evidenceKind: 'independent',
        answer: 'es'
      });
      const snapshot = async () => ({
        progress: await loadProgress(client, learner, 'fr'),
        rows: await Promise.all(
          grammarTables.map(
            async (table) =>
              // Every owner's rows, so a write for another learner shows too.
              (await client.execute(`SELECT * FROM ${table} ORDER BY rowid`))
                .rows
          )
        )
      });
      const before = await snapshot();
      expect(
        before.progress.tracks[0].skills.find(
          (skill) => skill.skillId === 'fr-a1-001'
        )
      ).toMatchObject({ correct: 1 });

      const note = await seedBasicNote(client, learner);
      await approveNote(client, learner, note.id);
      const ratings = ['again', 'hard', 'good', 'easy'] as const;
      for (const [revision, rating] of ratings.entries()) {
        await submitReview(client, learner, {
          cardId: note.cardId,
          submissionId: `50000000-0000-4000-8000-00000000000${revision}`,
          expectedRevision: revision,
          rating
        });
      }

      expect(
        (
          await client.execute({
            sql: 'SELECT count(*) AS count FROM native_flashcard_review_events WHERE owner_id = ?',
            args: [learner.userId]
          })
        ).rows[0].count
      ).toBe(ratings.length);
      expect(await snapshot()).toEqual(before);
    } finally {
      close();
    }
  });
});
