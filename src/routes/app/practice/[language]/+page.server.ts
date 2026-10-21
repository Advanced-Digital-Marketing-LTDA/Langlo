import { randomUUID } from 'node:crypto';
import { fail, isHttpError, isRedirect, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { studyPage } from '../../../../lib/server/learner-api';
import { requireLearnerApi } from '../../../../lib/server/learner-session';
import { loadEnrolledMastery } from '../../../../lib/server/mastery';
import {
  startGrammarReview,
  startPractice,
  startPracticeOver,
  unfinishedPractice
} from '../../../../lib/server/practice';
import { recommendPractice } from '../../../../lib/server/recommendations';
import { dueGrammarReviews } from '../../../../lib/server/grammar-retention';

export const load: PageServerLoad = async (event) => {
  const submissionKey = randomUUID();
  try {
    return await studyPage(event, async (client, learner) => {
      const [track] = await loadEnrolledMastery(
        client,
        learner,
        event.params.language
      );
      const dueReviews = await dueGrammarReviews(
        client,
        learner,
        event.params.language
      );
      return {
        language: track.language,
        submissionKey,
        unfinished: await unfinishedPractice(
          client,
          learner,
          event.params.language
        ),
        skills: track.skills,
        recommendations: recommendPractice(track.skills),
        dueReviews,
        error: null
      };
    });
  } catch (thrown) {
    if (isHttpError(thrown) || isRedirect(thrown)) throw thrown;
    console.error('Failed to load practice recommendations', thrown);
    return {
      language: event.params.language,
      submissionKey,
      unfinished: null,
      skills: [],
      recommendations: [],
      dueReviews: [],
      error:
        'Practice recommendations could not be loaded. Refresh to try again.'
    };
  }
};

/** An action that begins practice and sends the learner to its session. */
function practiceAction(begin: typeof startPractice): Actions[string] {
  return async (event) => {
    requireLearnerApi(event);
    const form = await event.request.formData();
    const practice = await studyPage(event, (client, learner) =>
      begin(client, learner, {
        language: event.params.language,
        submissionKey: form.get('submissionKey')
      })
    );
    redirect(303, `/app/session/${encodeURIComponent(practice.id)}`);
  };
}

export const actions: Actions = {
  start: practiceAction(startPractice),
  startOver: practiceAction(startPracticeOver),
  review: async (event) => {
    requireLearnerApi(event);
    const form = await event.request.formData();
    const skillIds = form.getAll('skillId');
    if (skillIds.length < 1 || skillIds.length > 5)
      return fail(400, { message: 'Choose between one and five due topics.' });
    const review = await studyPage(event, (client, learner) =>
      startGrammarReview(client, learner, {
        language: event.params.language,
        submissionKey: form.get('submissionKey'),
        skillIds
      })
    );
    redirect(303, `/app/session/${encodeURIComponent(review.id)}`);
  }
};
