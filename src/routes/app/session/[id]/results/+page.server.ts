import type { Actions, PageServerLoad } from './$types';
import { studyForm, studyPage } from '../../../../../lib/server/learner-api';
import {
  createMistakeDraft,
  listMistakeCandidates
} from '../../../../../lib/server/mistake-cards';
import { practiceSummary } from '../../../../../lib/server/practice';

export const load: PageServerLoad = (event) =>
  studyPage(event, async (client, learner) => ({
    summary: await practiceSummary(client, learner, event.params.id),
    mistakes: await listMistakeCandidates(client, learner, event.params.id)
  }));

export const actions: Actions = {
  keep: async (event) => {
    const form = await event.request.formData();
    return studyForm(
      event,
      (client, learner) =>
        createMistakeDraft(client, learner, {
          attemptId: String(form.get('attemptId') ?? ''),
          format: String(form.get('format') ?? 'basic')
        }),
      { saved: true }
    );
  }
};
