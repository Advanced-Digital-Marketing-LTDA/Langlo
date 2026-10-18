import type { RequestHandler } from './$types';
import { studyPage } from '../../../../../lib/server/learner-api';
import { exportDeckForAnki } from '../../../../../lib/server/flashcard-views';

export const GET: RequestHandler = async (event) => {
  const body = await studyPage(event, (client, learner) =>
    exportDeckForAnki(client, learner, event.params.id)
  );
  return new Response(body, {
    headers: {
      'content-type': 'text/tab-separated-values; charset=utf-8',
      'content-disposition': 'attachment; filename="langlo-deck.txt"',
      'cache-control': 'private, no-store'
    }
  });
};
