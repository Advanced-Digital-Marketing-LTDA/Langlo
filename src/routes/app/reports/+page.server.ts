import type { PageServerLoad } from './$types';
import { studyPage } from '../../../lib/server/learner-api';
import { listContentReports } from '../../../lib/server/content-reports';
export const load: PageServerLoad = (event) =>
  studyPage(event, async (client, learner) => ({
    reports: await listContentReports(client, learner)
  }));
