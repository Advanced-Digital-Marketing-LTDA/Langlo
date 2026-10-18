import { randomUUID } from 'node:crypto';
import type { Actions, PageServerLoad } from './$types';
import { studyForm, studyPage } from '../../../lib/server/learner-api';
import { submitReview } from '../../../lib/server/flashcards';
import {
  countDueCards,
  listDueCards
} from '../../../lib/server/flashcard-views';

type ReviewRating = Parameters<typeof submitReview>[2]['rating'];

export const load: PageServerLoad = (event) =>
  studyPage(event, async (client, learner) => ({
    cards: await listDueCards(client, learner),
    total: await countDueCards(client, learner),
    submissionKey: randomUUID()
  }));

export const actions: Actions = {
  rate: async (event) => {
    const form = await event.request.formData();
    return studyForm(
      event,
      (client, learner) =>
        submitReview(client, learner, {
          cardId: String(form.get('cardId') ?? ''),
          submissionId: String(form.get('submissionKey') ?? ''),
          expectedRevision: Number(form.get('revision')),
          rating: String(form.get('rating') ?? '') as ReviewRating
        }),
      { reviewed: true }
    );
  }
};
