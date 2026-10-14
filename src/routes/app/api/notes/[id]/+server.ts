import type { RequestHandler } from './$types';
import {
  learnerApi,
  withoutOwner
} from '../../../../../lib/server/learner-api';
import { getNote } from '../../../../../lib/server/flashcards';

export const GET: RequestHandler = (event) =>
  learnerApi(event, async (client, learner) => ({
    note: withoutOwner(await getNote(client, learner, event.params.id))
  }));
