import type { RequestHandler } from './$types';
import { learnerApi } from '../../../../lib/server/learner-api';
import { listLibraryDocuments } from '../../../../lib/server/library';

export const GET: RequestHandler = (event) =>
  learnerApi(event, async (client, learner) => ({
    documents: await listLibraryDocuments(client, learner)
  }));
