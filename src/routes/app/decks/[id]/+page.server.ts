import type { Actions, PageServerLoad } from './$types';
import { studyForm, studyPage } from '../../../../lib/server/learner-api';
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
    const form = await event.request.formData();
    return studyForm(
      event,
      (client, learner) =>
        addNoteFromForm(client, learner, event.params.id, form),
      { saved: true }
    );
  },
  approve: async (event) => {
    const form = await event.request.formData();
    return studyForm(
      event,
      (client, learner) =>
        approveNote(client, learner, String(form.get('noteId') ?? '')),
      { saved: true }
    );
  }
};
