import { randomUUID } from 'node:crypto';
import type { Actions, PageServerLoad } from './$types';
import { formResult, studyPage } from '../../../lib/server/learner-api';
import { requireLearnerApi } from '../../../lib/server/learner-session';
import { submitReview } from '../../../lib/server/flashcards';
import { listDueCards } from '../../../lib/server/flashcard-views';

export const load: PageServerLoad = (event) =>
  studyPage(event, async (client, learner) => ({
    cards: await listDueCards(client, learner),
    submissionKey: randomUUID()
  }));

export const actions: Actions = {
  rate: async (event) => {
    const learner = requireLearnerApi(event);
    const form = await event.request.formData();
    return formResult(
      () =>
        studyPage(event, (client) =>
          submitReview(client, learner, {
            cardId: String(form.get('cardId') ?? ''),
            submissionId: String(form.get('submissionKey') ?? ''),
            expectedRevision: Number(form.get('revision')),
            rating: String(form.get('rating') ?? '') as 'good'
          })
        ),
      { reviewed: true }
    );
  }
};
