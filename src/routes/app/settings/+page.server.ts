import type { Actions, PageServerLoad } from './$types';
import {
  studyForm,
  studyFormValue,
  studyPage
} from '../../../lib/server/learner-api';
import {
  EXPLANATION_LANGUAGES,
  listEnrollments,
  setExplanationLanguage
} from '../../../lib/server/enrollment';
import { getTimezone, setTimezone } from '../../../lib/server/preferences';
import {
  getStudySchedule,
  previewStudySchedule,
  saveStudySchedule
} from '../../../lib/server/flashcards';

export const load: PageServerLoad = (event) =>
  studyPage(event, async (client, learner) => ({
    enrollments: await listEnrollments(client, learner),
    explanationLanguages: EXPLANATION_LANGUAGES,
    timezone: await getTimezone(client, learner),
    studySchedule: await getStudySchedule(client, learner)
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
  },
  saveStudySchedule: async (event) => {
    const form = await event.request.formData();
    return studyForm(
      event,
      (client, learner) =>
        saveStudySchedule(client, learner, {
          desiredRetention: Number(form.get('desiredRetention')),
          newCardPreset: form.get('newCardPreset'),
          relearningPreset: form.get('relearningPreset')
        }),
      { saved: 'Study schedule saved.' }
    );
  },
  previewStudySchedule: async (event) => {
    const form = await event.request.formData();
    return studyFormValue(
      event,
      (client, learner) =>
        previewStudySchedule(client, learner, {
          desiredRetention: Number(form.get('desiredRetention')),
          newCardPreset: form.get('newCardPreset'),
          relearningPreset: form.get('relearningPreset')
        }),
      (preview) => ({ preview })
    );
  }
};
