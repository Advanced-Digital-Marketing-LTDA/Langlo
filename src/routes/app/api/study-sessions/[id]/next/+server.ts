import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { learnerApi } from '../../../../../../lib/server/learner-api';
import { nextQuestion } from '../../../../../../lib/server/study';

export const GET: RequestHandler = (event) => {
  const skill = event.url.searchParams.get('skill');
  if (!skill) error(400, { message: 'Invalid request.' });
  return learnerApi(event, (client, learner) =>
    nextQuestion(client, learner, event.params.id, skill)
  );
};
