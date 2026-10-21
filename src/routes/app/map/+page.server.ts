import { randomUUID } from 'node:crypto';
import { redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireLearnerApi } from '../../../lib/server/learner-session';
import { loadEnrolledMastery } from '../../../lib/server/mastery';
import { loadMapProgress } from '../../../lib/server/progress';
import { startPractice } from '../../../lib/server/practice';
import { StudyError } from '../../../lib/server/study-error';
import { studyPage } from '../../../lib/server/learner-api';
import { normalizeMapReturnTo } from '../../../lib/skill-map';

export const load: PageServerLoad = (event) => {
  const submissionKey = randomUUID();
  return studyPage(event, async (client, learner) => {
    const { tracks } = await loadMapProgress(client, learner);
    const requestedLanguage = event.url.searchParams.get('language');
    if (
      requestedLanguage &&
      !tracks.some((track) => track.language === requestedLanguage)
    )
      throw new StudyError('NOT_FOUND');
    return {
      tracks,
      initialLanguage: requestedLanguage || tracks[0]?.language || '',
      initialSearch: event.url.search,
      submissionKey
    };
  });
};

export const actions: Actions = {
  practise: async (event) => {
    requireLearnerApi(event);
    const form = await event.request.formData();
    const language = String(form.get('language') ?? '');
    const skillId = String(form.get('skillId') ?? '');
    const returnTo = normalizeMapReturnTo(form.get('returnTo'));
    await studyPage(event, async (client, learner) => {
      const [track] = await loadEnrolledMastery(client, learner, language);
      if (
        !track?.skills.some(
          (skill) => skill.skillId === skillId && skill.available
        )
      )
        throw new StudyError('NOT_FOUND');
      const session = await startPractice(client, learner, {
        language,
        submissionKey: form.get('submissionKey')
      });
      const lesson = `/app/learn/${encodeURIComponent(language)}/lesson/${encodeURIComponent(skillId)}`;
      redirect(
        303,
        `${lesson}?session=${encodeURIComponent(session.id)}&returnTo=${encodeURIComponent(returnTo)}`
      );
    });
  }
};
