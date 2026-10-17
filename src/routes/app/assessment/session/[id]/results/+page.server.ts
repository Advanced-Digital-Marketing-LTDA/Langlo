import { randomUUID } from 'node:crypto';
import type { Actions, PageServerLoad } from './$types';
import { studyPage } from '../../../../../../lib/server/learner-api';
import { assessmentResults } from '../../../../../../lib/server/assessment';
import { requireLearnerApi } from '../../../../../../lib/server/learner-session';
import { reportContentForm } from '../../../../../../lib/server/content-reports';
import { StudyError } from '../../../../../../lib/server/study-error';
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
