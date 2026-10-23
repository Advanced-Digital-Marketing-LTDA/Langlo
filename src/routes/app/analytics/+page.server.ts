import type { PageServerLoad } from './$types';
import { studyPage } from '../../../lib/server/learner-api';
import { loadProgress } from '../../../lib/server/progress';
import { loadReviewAnalytics } from '../../../lib/server/review-analytics';

export const load: PageServerLoad = (event) =>
  studyPage(event, async (client, learner) => {
    const { tracks } = await loadProgress(client, learner);
    return {
      days: await loadReviewAnalytics(client, learner, tracks)
    };
  });
