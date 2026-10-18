import type { Actions, PageServerLoad } from './$types';
import { studyForm, studyPage } from '../../../lib/server/learner-api';
import {
  EXPLANATION_LANGUAGES,
  listEnrollments,
  setExplanationLanguage
} from '../../../lib/server/enrollment';
import { getTimezone, setTimezone } from '../../../lib/server/preferences';

export const load: PageServerLoad = (event) =>
  studyPage(event, async (client, learner) => ({
    enrollments: await listEnrollments(client, learner),
    explanationLanguages: EXPLANATION_LANGUAGES,
    timezone: await getTimezone(client, learner)
  }));

export const actions: Actions = {
  explanationLanguage: async (event) => {
    const form = await event.request.formData();
    return studyForm(
      event,
      (client, learner) =>
        setExplanationLanguage(client, learner, {
          language: form.get('language'),
          explanationLanguage: form.get('explanationLanguage')
        }),
      { saved: 'Lesson language saved.' }
    );
  },
  timezone: async (event) => {
    const form = await event.request.formData();
    return studyForm(
      event,
      (client, learner) => setTimezone(client, learner, form.get('timezone')),
      { saved: 'Timezone saved.' }
    );
  }
};
