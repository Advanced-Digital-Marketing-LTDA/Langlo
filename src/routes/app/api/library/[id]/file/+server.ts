import type { RequestHandler } from './$types';
import { learnerResponse } from '../../../../../../lib/server/learner-api';
import { getLibraryDocumentFile } from '../../../../../../lib/server/library';

export const GET: RequestHandler = (event) =>
  learnerResponse(event, async (client, learner) => {
    const file = await getLibraryDocumentFile(client, learner, event.params.id);
    return new Response(file.bytes, {
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(file.bytes.byteLength),
        'cache-control': 'private, max-age=3600',
        'x-content-type-options': 'nosniff',
        'content-security-policy': 'sandbox'
      }
    });
  });
