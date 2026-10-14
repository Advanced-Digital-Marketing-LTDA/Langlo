import type { RequestHandler } from './$types';
import {
  learnerApi,
  withoutOwner
} from '../../../../../lib/server/learner-api';
import { getStudySession, listAttempts } from '../../../../../lib/server/study';

export const GET: RequestHandler = (event) =>
  learnerApi(event, async (client, learner) => ({
    studySession: await getStudySession(client, learner, event.params.id),
    attempts: (await listAttempts(client, learner, event.params.id)).map(
      (row) => withoutOwner(row)
    )
  }));
