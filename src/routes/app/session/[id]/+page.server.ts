import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { studyForm, studyPage } from '../../../../lib/server/learner-api';
import { requireLearnerApi } from '../../../../lib/server/learner-session';
import { loadProgress } from '../../../../lib/server/progress';
import { resumeStudySession } from '../../../../lib/server/study';
import {
  finishPractice,
  grammarReviewPlan,
  practiceResultsPath,
  practiceSummary
} from '../../../../lib/server/practice';

export const load: PageServerLoad = (event) =>
  studyPage(event, async (client, learner) => {
    const summary = await practiceSummary(client, learner, event.params.id);
    if (summary.state === 'completed')
      redirect(303, practiceResultsPath(summary.id));
    const [{ tracks }, reviewPlan] = await Promise.all([
      loadProgress(client, learner, summary.language),
      summary.mode === 'mixed-review'
        ? grammarReviewPlan(client, learner, summary.id)
        : Promise.resolve(null)
    ]);
    return {
      summary,
      skills: reviewPlan
        ? reviewPlan.map((skill) => ({ ...skill, available: true }))
        : (tracks[0]?.skills ?? []).filter((skill) => skill.available),
      recommendedSkillId: tracks[0]?.recommendation?.skillId ?? null
    };
  });

export const actions: Actions = {
  resume: async (event) =>
    studyForm(
      event,
      (client, learner) => resumeStudySession(client, learner, event.params.id),
      { resumed: true }
    ),
  finish: async (event) => {
    requireLearnerApi(event);
    await studyPage(event, (client, learner) =>
      finishPractice(client, learner, event.params.id)
    );
    redirect(303, practiceResultsPath(event.params.id));
  }
};
