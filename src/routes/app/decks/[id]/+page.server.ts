import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { studyForm, studyPage } from '../../../../lib/server/learner-api';
import {
  FlashcardError,
  listDecks,
  rejectNote,
  setCardSuspended,
  updateNote
} from '../../../../lib/server/flashcards';
import {
  addNoteFromForm,
  approveOwnNote,
  listNotes
} from '../../../../lib/server/flashcard-views';

export const load: PageServerLoad = (event) =>
  studyPage(event, async (client, learner) => {
    const [result, decks] = await Promise.all([
      listNotes(client, learner, event.params.id),
      listDecks(client, learner)
    ]);
    const requested = event.url.searchParams.get('note');
    return {
      ...result,
      decks,
      focusNoteId: result.notes.some((note) => note.id === requested)
        ? requested
        : null
    };
  });

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
          explanation: String(form.get('explanation') ?? ''),
          tags: form.has('tags') ? form.get('tags') : undefined,
          deckId: form.has('deckId') ? form.get('deckId') : undefined
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
  },
  suspension: async (event) => {
    const form = await event.request.formData();
    const value = String(form.get('suspended') ?? '');
    if (value !== 'true' && value !== 'false')
      return fail(400, { message: 'Choose Suspend or Resume.' });
    return studyForm(
      event,
      (client, learner) =>
        setCardSuspended(
          client,
          learner,
          String(form.get('cardId') ?? ''),
          value === 'true'
        ),
      { saved: true }
    );
  }
};
