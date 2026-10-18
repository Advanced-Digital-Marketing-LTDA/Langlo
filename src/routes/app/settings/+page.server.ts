import type { Actions, PageServerLoad } from './$types';
import { formResult, studyPage } from '../../../lib/server/learner-api';
import { requireLearnerApi } from '../../../lib/server/learner-session';
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
    const learner = requireLearnerApi(event);
    const form = await event.request.formData();
    return formResult(
      () =>
        studyPage(event, (client) =>
          setExplanationLanguage(client, learner, {
            language: form.get('language'),
            explanationLanguage: form.get('explanationLanguage')
          })
        ),
      { saved: 'Lesson language saved.' }
    );
  },
  timezone: async (event) => {
    const learner = requireLearnerApi(event);
    const form = await event.request.formData();
    return formResult(
      () =>
        studyPage(event, (client) =>
          setTimezone(client, learner, form.get('timezone'))
        ),
      { saved: 'Timezone saved.' }
    );
  }
};
