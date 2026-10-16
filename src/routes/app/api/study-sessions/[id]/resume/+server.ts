import type { RequestHandler } from './$types';
import { learnerApi } from '../../../../../../lib/server/learner-api';
import { resumeStudySession } from '../../../../../../lib/server/study';

export const POST: RequestHandler = (event) =>
  learnerApi(event, async (client, learner) => ({
    studySession: await resumeStudySession(client, learner, event.params.id)
  }));
