import { randomUUID } from 'node:crypto';
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { studyPage } from '../../../../lib/server/learner-api';
import { requireLearnerApi } from '../../../../lib/server/learner-session';
import { listEnrollments } from '../../../../lib/server/enrollment';
import { startPractice } from '../../../../lib/server/practice';
import { StudyError } from '../../../../lib/server/study-error';

export const load: PageServerLoad = (event) =>
  studyPage(event, async (client, learner) => {
    const track = (await listEnrollments(client, learner)).find(
      (item) => item.language === event.params.language
    );
    if (!track) throw new StudyError('NOT_FOUND');
    return { language: track.language, submissionKey: randomUUID() };
  });

export const actions: Actions = {
  start: async (event) => {
    requireLearnerApi(event);
    const form = await event.request.formData();
    const practice = await studyPage(event, (client, learner) =>
      startPractice(client, learner, {
        language: event.params.language,
        submissionKey: form.get('submissionKey')
      })
    );
    redirect(303, `/app/session/${encodeURIComponent(practice.id)}`);
  }
};
