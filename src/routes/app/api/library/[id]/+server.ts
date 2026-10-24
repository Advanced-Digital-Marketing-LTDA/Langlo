import type { RequestHandler } from './$types';
import {
  learnerApi,
  readJsonObject
} from '../../../../../lib/server/learner-api';
import {
  deleteLibraryDocument,
  getLibraryDocument,
  updateLibraryProgress
} from '../../../../../lib/server/library';

export const GET: RequestHandler = (event) =>
  learnerApi(event, async (client, learner) => ({
    document: await getLibraryDocument(client, learner, event.params.id)
  }));

export const PATCH: RequestHandler = (event) =>
  learnerApi(event, async (client, learner) => {
    const body = await readJsonObject(event.request);
    await updateLibraryProgress(
      client,
      learner,
      event.params.id,
      body.progressIndex
    );
    return { saved: true };
  });

export const DELETE: RequestHandler = (event) =>
  learnerApi(event, async (client, learner) => {
    await deleteLibraryDocument(client, learner, event.params.id);
    return { deleted: true };
  });
