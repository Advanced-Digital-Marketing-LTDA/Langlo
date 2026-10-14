import type { RequestHandler } from './$types';
import {
  learnerApi,
  readJsonObject
} from '../../../../../../lib/server/learner-api';
import {
  listReviewEvents,
  submitReview
} from '../../../../../../lib/server/flashcards';

export const GET: RequestHandler = (event) =>
  learnerApi(event, async (client, learner) => ({
    events: await listReviewEvents(client, learner, event.params.id)
  }));

export const POST: RequestHandler = async (event) => {
  const body = await readJsonObject(event.request);
  return learnerApi(event, (client, learner) =>
    submitReview(client, learner, {
      cardId: event.params.id,
      submissionId: body.submissionId as string,
      expectedRevision: body.expectedRevision as number,
      rating: body.rating as 'again' | 'hard' | 'good' | 'easy'
    })
  );
};
