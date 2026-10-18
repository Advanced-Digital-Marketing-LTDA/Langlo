import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { studyPage } from '../../../../lib/server/learner-api';
import { requireLearnerApi } from '../../../../lib/server/learner-session';
import { loadProgress } from '../../../../lib/server/progress';
import {
  finishPractice,
  practiceResultsPath,
  practiceSummary
} from '../../../../lib/server/practice';

export const load: PageServerLoad = (event) =>
  studyPage(event, async (client, learner) => {
    const summary = await practiceSummary(client, learner, event.params.id);
    if (summary.state === 'completed')
      redirect(303, practiceResultsPath(summary.id));
    const { tracks } = await loadProgress(client, learner, summary.language);
    return {
      summary,
      skills: (tracks[0]?.skills ?? []).filter((skill) => skill.available),
      recommendedSkillId: tracks[0]?.recommendation?.skillId ?? null
    };
  });

export const actions: Actions = {
  finish: async (event) => {
    requireLearnerApi(event);
    await studyPage(event, (client, learner) =>
      finishPractice(client, learner, event.params.id)
    );
    redirect(303, practiceResultsPath(event.params.id));
  }
};
