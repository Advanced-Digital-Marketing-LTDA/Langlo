import { randomUUID } from 'node:crypto';
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { formResult, studyPage } from '../../../lib/server/learner-api';
import { requireLearnerApi } from '../../../lib/server/learner-session';
import { createDeck, listDecks } from '../../../lib/server/flashcards';
import { searchNotes } from '../../../lib/server/flashcard-views';

export const load: PageServerLoad = (event) =>
  studyPage(event, async (client, learner) => {
    const query = event.url.searchParams.get('q') ?? '';
    const search = query.trim()
      ? await searchNotes(
          client,
          learner,
          query,
          Number(event.url.searchParams.get('after') ?? 0)
        )
      : { results: [], nextCursor: null };
    return {
      decks: await listDecks(client, learner),
      query,
      ...search
    };
  });

export const actions: Actions = {
  createDeck: async (event) => {
    const learner = requireLearnerApi(event);
    const form = await event.request.formData();
    const id = `deck:${randomUUID()}`;
    const failed = await formResult(
      () =>
        studyPage(event, (client) =>
          createDeck(client, learner, {
            id,
            name: String(form.get('name') ?? '')
          })
        ),
      null
    );
    if (failed) return failed;
    redirect(303, `/app/decks/${encodeURIComponent(id)}`);
  }
};
