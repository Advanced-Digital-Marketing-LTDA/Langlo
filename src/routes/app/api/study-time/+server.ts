import type { RequestHandler } from './$types';
import { learnerApi, readJsonObject } from '../../../../lib/server/learner-api';
import { recordStudyTime } from '../../../../lib/server/study-time';

export const POST: RequestHandler = async (event) => {
  const body = await readJsonObject(event.request);
  return learnerApi(
    event,
    (client, learner) => recordStudyTime(client, learner, body),
    201
  );
};
