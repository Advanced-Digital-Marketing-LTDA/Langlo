import type { PageServerLoad } from './$types';
import { studyPage } from '../../../../../lib/server/learner-api';
import { practiceSummary } from '../../../../../lib/server/practice';

export const load: PageServerLoad = (event) =>
  studyPage(event, async (client, learner) => ({
    summary: await practiceSummary(client, learner, event.params.id)
  }));
