import type { RequestHandler } from './$types';
import {
  learnerApi,
  withoutOwner
} from '../../../../../lib/server/learner-api';
import { getAttempt } from '../../../../../lib/server/study';

export const GET: RequestHandler = (event) =>
  learnerApi(event, async (client, learner) => ({
    attempt: withoutOwner(await getAttempt(client, learner, event.params.id))
  }));
