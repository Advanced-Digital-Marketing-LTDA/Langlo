import type { RequestHandler } from './$types';
import { learnerApi } from '../../../../../../lib/server/learner-api';
import { rejectNote } from '../../../../../../lib/server/flashcards';

export const POST: RequestHandler = (event) =>
  learnerApi(event, (client, learner) =>
    rejectNote(client, learner, event.params.id)
  );
