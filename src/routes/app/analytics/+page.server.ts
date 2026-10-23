import type { PageServerLoad } from './$types';
import { studyPage } from '../../../lib/server/learner-api';
import { getTimezone } from '../../../lib/server/preferences';
import { loadProgress } from '../../../lib/server/progress';
import {
  loadReviewCounts,
  reviewAnalyticsDays
} from '../../../lib/server/review-analytics';
import {
  loadStudySegments,
  studyTimeDays
} from '../../../lib/server/study-time';

export const load: PageServerLoad = (event) =>
  studyPage(event, async (client, learner) => {
    const now = Date.now();
    // The timezone is read once, and the review and study-time reads do not
    // wait for the progress reads.
    const timezone = getTimezone(client, learner).then((zone) => zone ?? 'UTC');
    const [{ tracks }, counts, segments] = await Promise.all([
      loadProgress(client, learner),
      timezone.then((zone) => loadReviewCounts(client, learner, zone, now)),
      timezone.then((zone) => loadStudySegments(client, learner, zone, now))
    ]);
    const days = reviewAnalyticsDays(counts, tracks);
    return { days, studyTime: studyTimeDays(segments, days[0].date) };
  });
