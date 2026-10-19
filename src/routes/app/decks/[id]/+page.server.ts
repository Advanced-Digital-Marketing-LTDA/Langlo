import type { Actions, PageServerLoad } from './$types';
import { studyForm, studyPage } from '../../../../lib/server/learner-api';
import {
  FlashcardError,
  rejectNote,
  updateNote
} from '../../../../lib/server/flashcards';
import {
  addNoteFromForm,
  approveOwnNote,
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
        approveOwnNote(client, learner, String(form.get('noteId') ?? '')),
      { saved: true }
    );
  },
  edit: async (event) => {
    const form = await event.request.formData();
    return studyForm(
      event,
      (client, learner) => {
        const kind = form.get('kind');
        if (kind !== 'basic' && kind !== 'cloze')
          throw new FlashcardError('INVALID_FORMAT');
        const content =
          kind === 'cloze'
            ? { text: String(form.get('text') ?? '') }
            : {
                front: String(form.get('front') ?? ''),
                back: String(form.get('back') ?? '')
              };
        return updateNote(client, learner, String(form.get('noteId') ?? ''), {
          kind,
          content,
          explanation: String(form.get('explanation') ?? '')
        });
      },
      { saved: true }
    );
  },
  reject: async (event) => {
    const form = await event.request.formData();
    return studyForm(
      event,
      (client, learner) =>
        rejectNote(client, learner, String(form.get('noteId') ?? '')),
      { saved: true }
    );
  }
};
