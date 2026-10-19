import type { RequestHandler } from './$types';
import {
  learnerApi,
  readJsonObject
} from '../../../../../../lib/server/learner-api';
import { createMistakeDraft } from '../../../../../../lib/server/mistake-cards';

export const POST: RequestHandler = (event) =>
  learnerApi(
    event,
    async (client, learner) => {
      const body = await readJsonObject(event.request);
      return {
        note: await createMistakeDraft(client, learner, {
          attemptId: event.params.id,
          format: body.format
        })
      };
    },
    201
  );
