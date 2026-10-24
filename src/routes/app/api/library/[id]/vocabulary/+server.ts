import type { RequestHandler } from './$types';
import {
  learnerApi,
  readJsonObject
} from '../../../../../../lib/server/learner-api';
import { saveLibraryVocabulary } from '../../../../../../lib/server/library';

export const POST: RequestHandler = (event) =>
  learnerApi(event, async (client, learner) => {
    const body = await readJsonObject(event.request);
    return {
      note: await saveLibraryVocabulary(client, learner, {
        documentId: event.params.id,
        deckId: typeof body.deckId === 'string' ? body.deckId : '',
        term: body.term,
        definition: body.definition
      })
    };
  });
