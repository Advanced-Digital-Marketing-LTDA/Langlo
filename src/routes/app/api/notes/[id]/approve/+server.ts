import type { RequestHandler } from './$types';
import { learnerApi } from '../../../../../../lib/server/learner-api';
import { approveNote } from '../../../../../../lib/server/flashcards';

export const POST: RequestHandler = (event) =>
  learnerApi(event, async (client, learner) => {
    await approveNote(client, learner, event.params.id);
    return { id: event.params.id, status: 'approved' };
  });
