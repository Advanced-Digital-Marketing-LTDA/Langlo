import { randomUUID } from 'node:crypto';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { studyPage } from '../../../../../../lib/server/learner-api';
import { assessmentResults } from '../../../../../../lib/server/assessment';
import { requireLearnerApi } from '../../../../../../lib/server/learner-session';
import { reportContentForm } from '../../../../../../lib/server/content-reports';
import { StudyError } from '../../../../../../lib/server/study-error';
import {
  discardUnratedAssessmentAnswer,
  rateGrammarAttempt
} from '../../../../../../lib/server/study';
export const load: PageServerLoad = (event) =>
  studyPage(event, async (client, learner) => {
    const results = await assessmentResults(client, learner, event.params.id, {
      awaitFallback: Boolean(event.locals.config?.openAiKey)
    });
    return {
      results,
      reportKeys: Object.fromEntries(
        results.items.map((item) => [item.questionId, randomUUID()])
      )
    };
  });
export const actions: Actions = {
  discard: async (event) => {
    requireLearnerApi(event);
    const form = await event.request.formData();
    const attemptId = form.get('attemptId');
    if (typeof attemptId !== 'string')
      return fail(400, { message: 'Choose an answer to discard.' });
    await studyPage(event, (client, learner) =>
      discardUnratedAssessmentAnswer(
        client,
        learner,
        attemptId,
        event.params.id
      )
    );
    redirect(
      303,
      `/app/assessment/session/${encodeURIComponent(event.params.id)}`
    );
  },
  rate: async (event) => {
    requireLearnerApi(event);
    const form = await event.request.formData();
    const attemptId = form.get('attemptId');
    const rating = form.get('rating');
    if (
      typeof attemptId !== 'string' ||
      !['hard', 'good', 'easy'].includes(String(rating))
    )
      return fail(400, { message: 'Choose Hard, Good, or Easy.' });
    await studyPage(event, (client, learner) =>
      rateGrammarAttempt(client, learner, {
        attemptId: attemptId,
        rating: rating as 'hard' | 'good' | 'easy',
        expectedSessionId: event.params.id
      })
    );
    return { rated: true };
  },
  report: async (event) => {
    requireLearnerApi(event);
    const form = await event.request.formData();
    return studyPage(event, async (client, learner) => {
      const results = await assessmentResults(client, learner, event.params.id);
      if (
        !results.items.some(
          (item) =>
            item.questionId === form.get('questionId') &&
            item.contentVersionId === form.get('contentVersionId')
        )
      )
        throw new StudyError('NOT_FOUND');
      return reportContentForm(client, learner, form);
    });
  }
};
