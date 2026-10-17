import { randomUUID } from 'node:crypto';
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { studyPage } from '../../../../lib/server/learner-api';
import { requireLearnerApi } from '../../../../lib/server/learner-session';
import { startAssessment } from '../../../../lib/server/assessment';
import { StudyError } from '../../../../lib/server/study-error';

export const load: PageServerLoad = (event) =>
  studyPage(event, async (client, learner) => {
    const enrolled = await client.execute({
      sql: 'SELECT starting_level FROM enrollments WHERE owner_id = ? AND language = ?',
      args: [learner.userId, event.params.language]
    });
    if (!enrolled.rows[0]) throw new StudyError('NOT_FOUND');
    return {
      language: event.params.language,
      level: String(enrolled.rows[0].starting_level),
      submissionKey: randomUUID()
    };
  });
export const actions: Actions = {
  start: async (event) => {
    requireLearnerApi(event);
    const form = await event.request.formData();
    const assessment = await studyPage(event, (client, learner) =>
      startAssessment(client, learner, {
        language: event.params.language,
        submissionKey: String(form.get('submissionKey') ?? '')
      })
    );
    redirect(
      303,
      `/app/assessment/session/${encodeURIComponent(assessment.id)}`
    );
  }
};
