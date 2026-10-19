import type { PageServerLoad } from './$types';
import { studyPage } from '../../../lib/server/learner-api';
import { loadMapProgress } from '../../../lib/server/progress';
export const load: PageServerLoad = (event) =>
  studyPage(event, (client, learner) =>
    loadMapProgress(client, learner, event.url.searchParams.get('language'))
  );
