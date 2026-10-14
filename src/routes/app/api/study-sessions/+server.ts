import type { RequestHandler } from './$types';
import { learnerApi } from '../../../../lib/server/learner-api';
import { listStudySessions } from '../../../../lib/server/study';

export const GET: RequestHandler = (event) =>
  learnerApi(event, async (client, learner) => ({
    studySessions: await listStudySessions(client, learner)
  }));
