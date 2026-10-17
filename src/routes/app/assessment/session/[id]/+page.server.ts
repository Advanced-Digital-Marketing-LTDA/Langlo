import { randomUUID } from 'node:crypto';
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { studyPage } from '../../../../../lib/server/learner-api';
import { requireLearnerApi } from '../../../../../lib/server/learner-session';
import { getAssessment } from '../../../../../lib/server/assessment';
import { recordAssessmentAnswer } from '../../../../../lib/server/assessment-answer';
import { fallbackEvaluator } from '../../../../../lib/server/evaluation/runtime';
import { resumeStudySession } from '../../../../../lib/server/study';

export const load: PageServerLoad = (event) =>
  studyPage(event, async (client, learner) => {
    const assessment = await getAssessment(client, learner, event.params.id);
    if (assessment.state === 'completed')
      redirect(
        303,
        `/app/assessment/session/${encodeURIComponent(assessment.id)}/results`
      );
    return { assessment, submissionKey: randomUUID() };
  });
export const actions: Actions = {
  answer: async (event) => {
    requireLearnerApi(event);
    const form = await event.request.formData();
    const result = await studyPage(event, (client, learner) =>
      recordAssessmentAnswer(
        client,
        learner,
        event.params.id,
        form,
        fallbackEvaluator(client, event.locals.config)
      )
    );
    if ('recorded' in result)
      redirect(
        303,
        `/app/assessment/session/${encodeURIComponent(event.params.id)}`
      );
    return result;
  },
  resume: async (event) => {
    requireLearnerApi(event);
    await studyPage(event, async (client, learner) => {
      await getAssessment(client, learner, event.params.id);
      await resumeStudySession(client, learner, event.params.id);
    });
    redirect(
      303,
      `/app/assessment/session/${encodeURIComponent(event.params.id)}`
    );
  }
};
