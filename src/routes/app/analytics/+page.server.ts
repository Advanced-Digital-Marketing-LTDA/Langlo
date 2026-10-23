import type { PageServerLoad } from './$types';
import { studyPage } from '../../../lib/server/learner-api';
import { loadProgress } from '../../../lib/server/progress';
import { loadReviewAnalytics } from '../../../lib/server/review-analytics';
import { loadStudyTime } from '../../../lib/server/study-time';

export const load: PageServerLoad = (event) =>
  studyPage(event, async (client, learner) => {
    const { tracks } = await loadProgress(client, learner);
    const days = await loadReviewAnalytics(client, learner, tracks);
    return {
      days,
      studyTime: await loadStudyTime(client, learner, days[0].date)
    };
  });
