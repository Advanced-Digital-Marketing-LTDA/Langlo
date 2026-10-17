import type { PageServerLoad } from './$types';
import { studyPage } from '../../../lib/server/learner-api';
import { loadProgress } from '../../../lib/server/progress';
export const load: PageServerLoad = (event) =>
  studyPage(event, (client, learner) =>
    loadProgress(client, learner, event.url.searchParams.get('language'))
  );
