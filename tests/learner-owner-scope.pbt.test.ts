import fc from 'fast-check';
import { expect, it } from 'vitest';
import { propertyOptions } from './property-options';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import {
  approveNote,
  createNote,
  getNote,
  listReviewEvents,
  submitReview
} from '../src/lib/server/flashcards';
import { createDeck } from './fixtures/french-deck';
import {
  getAttempt,
  getStudySession,
  listAttempts,
  listEvaluations,
  recordAttempt
} from '../src/lib/server/study';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession,
  testSourceId
} from './fixtures/flashcards';
import { privateState } from './fixtures/owner-scope';

// Owner B guesses identifiers: owner A's real IDs mixed with arbitrary strings.
// Every read is NOT_FOUND and every write leaves all private rows unchanged.
it('guessed identifiers give another owner zero reads and zero writes', async () => {
  const target = await fixture();
  const opened = await openFixtureDatabase(target).catch(async (error) => {
    await disposeFlashcardFixtures();
    throw error;
  });
  const { client, close } = opened;
  try {
    const ownerA = testSession('learner-a');
    const ownerB = testSession('learner-b');
    await createDeck(client, ownerA, { id: 'deck-a', name: 'Français' });
    await createNote(client, ownerA, {
      id: 'note-a',
      sourceId: testSourceId('a'),
      deckId: 'deck-a',
      kind: 'basic',
      content: { front: 'Merci', back: 'Thanks' }
    });
    await approveNote(client, ownerA, 'note-a');
    await submitReview(client, ownerA, {
      cardId: 'card:note-a',
      submissionId: 'a0000000-0000-4000-8000-000000000001',
      expectedRevision: 0,
      rating: 'good'
    });
    const baseline = await privateState(client);
    const guess = fc.oneof(
      fc.constantFrom(
        'study-a',
        'attempt-a',
        'evaluation-a',
        'deck-a',
        'note-a',
        'card:note-a',
        'review-a',
        'submit-a'
      ),
      fc.string({ minLength: 1, maxLength: 80 })
    );
    await fc.assert(
      fc.asyncProperty(guess, async (id) => {
        if (id !== 'study-b')
          await expect(getStudySession(client, ownerB, id)).rejects.toThrow(
            'NOT_FOUND'
          );
        await expect(getAttempt(client, ownerB, id)).rejects.toThrow(
          'NOT_FOUND'
        );
        if (id !== 'study-b')
          await expect(listAttempts(client, ownerB, id)).rejects.toThrow(
            'NOT_FOUND'
          );
        await expect(listEvaluations(client, ownerB, id)).rejects.toThrow(
          'NOT_FOUND'
        );
        await expect(getNote(client, ownerB, id)).rejects.toThrow('NOT_FOUND');
        await expect(listReviewEvents(client, ownerB, id)).rejects.toThrow(
          'NOT_FOUND'
        );
        await expect(approveNote(client, ownerB, id)).rejects.toThrow(
          'NOT_FOUND'
        );
        await expect(
          submitReview(client, ownerB, {
            cardId: id,
            submissionId: id,
            expectedRevision: 1,
            rating: 'again'
          })
        ).rejects.toThrow(/NOT_FOUND|INVALID_SUBMISSION_ID/);
        if (id !== 'study-b')
          await expect(
            recordAttempt(client, ownerB, {
              studySessionId: id,
              questionId: 'question-1',
              submissionKey: `guess:${id}`,
              evidenceKind: 'independent',
              answer: 'un'
            })
          ).rejects.toThrow(/NOT_FOUND|INVALID_/);
        expect(await privateState(client)).toEqual(baseline);
      }),
      propertyOptions()
    );
  } finally {
    close();
    await disposeFlashcardFixtures();
  }
});
