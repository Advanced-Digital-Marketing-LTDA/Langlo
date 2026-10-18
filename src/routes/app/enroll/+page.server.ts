import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { formResult, studyPage } from '../../../lib/server/learner-api';
import { requireLearnerApi } from '../../../lib/server/learner-session';
import {
  enroll,
  EXPLANATION_LANGUAGES,
  listEnrollments,
  levelsFor,
  TRACK_LANGUAGES
} from '../../../lib/server/enrollment';

export const load: PageServerLoad = (event) =>
  studyPage(event, async (client, learner) => ({
    enrolled: (await listEnrollments(client, learner)).map(
      (track) => track.language
    ),
    languages: TRACK_LANGUAGES,
    levels: Object.fromEntries(
      TRACK_LANGUAGES.map((language) => [language, levelsFor(language)])
    ),
    explanationLanguages: EXPLANATION_LANGUAGES
  }));

export const actions: Actions = {
  enroll: async (event) => {
    const learner = requireLearnerApi(event);
    const form = await event.request.formData();
    const input = {
      language: form.get('language'),
      startingLevel: form.get('startingLevel'),
      explanationLanguage: form.get('explanationLanguage')
    };
    const failed = await formResult(
      () => studyPage(event, (client) => enroll(client, learner, input)),
      null
    );
    if (failed) return failed;
    redirect(303, '/app');
  }
};
