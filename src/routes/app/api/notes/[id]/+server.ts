import type { RequestHandler } from './$types';
import {
  learnerApi,
  readJsonObject,
  withoutOwner
} from '../../../../../lib/server/learner-api';
import { getNote, updateNote } from '../../../../../lib/server/flashcards';

export const GET: RequestHandler = (event) =>
  learnerApi(event, async (client, learner) => ({
    note: withoutOwner(await getNote(client, learner, event.params.id))
  }));

export const PATCH: RequestHandler = (event) =>
  learnerApi(event, async (client, learner) => {
    const body = await readJsonObject(event.request);
    return {
      note: await updateNote(client, learner, event.params.id, {
        kind: body.kind,
        content: body.content,
        explanation: body.explanation
      })
    };
  });
