import type { RequestHandler } from './$types';
import { learnerApi, readJsonObject } from '../../../../lib/server/learner-api';
import { recordAttempt } from '../../../../lib/server/study';

export const POST: RequestHandler = async (event) => {
  const body = await readJsonObject(event.request);
  return learnerApi(
    event,
    (client, learner) =>
      recordAttempt(client, learner, {
        studySessionId: body.studySessionId as string,
        questionId: body.questionId as string,
        submissionKey: body.submissionKey as string,
        evidenceKind: body.evidenceKind as 'independent' | 'assisted',
        answer: body.answer as string
      }),
    201
  );
};
