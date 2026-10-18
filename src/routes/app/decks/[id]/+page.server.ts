import { fail, isHttpError } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { studyPage } from '../../../../lib/server/learner-api';
import { requireLearnerApi } from '../../../../lib/server/learner-session';
import { approveNote } from '../../../../lib/server/flashcards';
import {
  addNoteFromForm,
  listNotes
} from '../../../../lib/server/flashcard-views';

export const load: PageServerLoad = (event) =>
  studyPage(event, (client, learner) =>
    listNotes(client, learner, event.params.id)
  );

/** Show 4xx repository failures on the form instead of an error page. */
async function toForm(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (thrown) {
    if (isHttpError(thrown) && thrown.status < 500)
      return fail(thrown.status, { message: thrown.body.message });
    throw thrown;
  }
  return { saved: true };
}

export const actions: Actions = {
  addNote: async (event) => {
    const learner = requireLearnerApi(event);
    const form = await event.request.formData();
    return toForm(() =>
      studyPage(event, (client) =>
        addNoteFromForm(client, learner, event.params.id, form)
      )
    );
  },
  approve: async (event) => {
    const learner = requireLearnerApi(event);
    const form = await event.request.formData();
    return toForm(() =>
      studyPage(event, (client) =>
        approveNote(client, learner, String(form.get('noteId') ?? ''))
      )
    );
  }
};
