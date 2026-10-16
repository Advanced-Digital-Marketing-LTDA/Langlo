import type { RequestHandler } from './$types';
import { learnerApi } from '../../../../../../lib/server/learner-api';
import { pauseStudySession } from '../../../../../../lib/server/study';

export const POST: RequestHandler = (event) =>
  learnerApi(event, async (client, learner) => ({
    studySession: await pauseStudySession(client, learner, event.params.id)
  }));
