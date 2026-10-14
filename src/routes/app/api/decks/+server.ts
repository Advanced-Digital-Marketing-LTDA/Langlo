import type { RequestHandler } from './$types';
import { learnerApi } from '../../../../lib/server/learner-api';
import { listDecks } from '../../../../lib/server/flashcards';

export const GET: RequestHandler = (event) =>
  learnerApi(event, async (client, learner) => ({
    decks: await listDecks(client, learner)
  }));
