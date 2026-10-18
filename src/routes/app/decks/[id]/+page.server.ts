import type { Actions, PageServerLoad } from './$types';
import { formResult, studyPage } from '../../../../lib/server/learner-api';
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

export const actions: Actions = {
  addNote: async (event) => {
    const learner = requireLearnerApi(event);
    const form = await event.request.formData();
    return formResult(
      () =>
        studyPage(event, (client) =>
          addNoteFromForm(client, learner, event.params.id, form)
        ),
      { saved: true }
    );
  },
  approve: async (event) => {
    const learner = requireLearnerApi(event);
    const form = await event.request.formData();
    return formResult(
      () =>
        studyPage(event, (client) =>
          approveNote(client, learner, String(form.get('noteId') ?? ''))
        ),
      { saved: true }
    );
  }
};
