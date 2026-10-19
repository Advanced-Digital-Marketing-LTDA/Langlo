import { randomUUID } from 'node:crypto';
import { isHttpError, isRedirect, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { studyPage } from '../../../../lib/server/learner-api';
import { requireLearnerApi } from '../../../../lib/server/learner-session';
import { loadEnrolledMastery } from '../../../../lib/server/mastery';
import { startPractice } from '../../../../lib/server/practice';
import { recommendPractice } from '../../../../lib/server/recommendations';

export const load: PageServerLoad = async (event) => {
  const submissionKey = randomUUID();
  try {
    return await studyPage(event, async (client, learner) => {
      const [track] = await loadEnrolledMastery(
        client,
        learner,
        event.params.language
      );
      return {
        language: track.language,
        submissionKey,
        skills: track.skills,
        recommendations: recommendPractice(track.skills),
        error: null
      };
    });
  } catch (thrown) {
    if (isHttpError(thrown) || isRedirect(thrown)) throw thrown;
    console.error('Failed to load practice recommendations', thrown);
    return {
      language: event.params.language,
      submissionKey,
      skills: [],
      recommendations: [],
      error:
        'Practice recommendations could not be loaded. Refresh to try again.'
    };
  }
};

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
