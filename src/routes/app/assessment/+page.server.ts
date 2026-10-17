import type { PageServerLoad } from './$types';
import { studyPage } from '../../../lib/server/learner-api';

export const load: PageServerLoad = (event) =>
  studyPage(event, async (client, learner) => {
    const tracks = await client.execute({
      sql: 'SELECT language, starting_level FROM enrollments WHERE owner_id = ? ORDER BY language',
      args: [learner.userId]
    });
    const saved = await client.execute({
      sql: "SELECT id, language, state FROM study_sessions WHERE owner_id = ? AND assessment_plan IS NOT NULL AND state <> 'completed' ORDER BY created_at, id",
      args: [learner.userId]
    });
    return {
      tracks: tracks.rows.map((row) => ({
        language: String(row.language),
        level: String(row.starting_level)
      })),
      saved: saved.rows.map((row) => ({
        id: String(row.id),
        language: String(row.language),
        state: String(row.state)
      }))
    };
  });
