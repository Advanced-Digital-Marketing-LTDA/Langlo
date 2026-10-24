import { randomUUID } from 'node:crypto';
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
  formResult,
  studyForm,
  studyPage
} from '../../../lib/server/learner-api';
import {
  createLibraryDocument,
  deleteLibraryDocument,
  listLibraryDocuments,
  parseLibraryDocument,
  renameLibraryDocument
} from '../../../lib/server/library';
import { StudyError } from '../../../lib/server/study-error';

export const load: PageServerLoad = (event) =>
  studyPage(event, async (client, learner) => ({
    documents: await listLibraryDocuments(client, learner)
  }));

export const actions: Actions = {
  upload: async (event) => {
    const form = await event.request.formData();
    const id = `library-${randomUUID()}`;
    const failure = await formResult(
      () =>
        studyPage(event, async (client, learner) => {
          const file = form.get('file');
          if (!(file instanceof File))
            throw new StudyError('INVALID_LIBRARY_FILE');
          const parsed = await parseLibraryDocument(file, form.get('language'));
          await createLibraryDocument(client, learner, { id, ...parsed });
        }),
      null
    );
    if (failure) return failure;
    redirect(303, `/app/library/${encodeURIComponent(id)}`);
  },
  rename: async (event) => {
    const form = await event.request.formData();
    return studyForm(
      event,
      (client, learner) =>
        renameLibraryDocument(
          client,
          learner,
          String(form.get('documentId') ?? ''),
          form.get('title')
        ),
      { saved: true }
    );
  },
  delete: async (event) => {
    const form = await event.request.formData();
    return studyForm(
      event,
      (client, learner) =>
        deleteLibraryDocument(
          client,
          learner,
          String(form.get('documentId') ?? '')
        ),
      { saved: true }
    );
  }
};
