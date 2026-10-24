import { StudyError } from './study-error';

export const MAX_REQUEST_BODY_BYTES = 512 * 1024;

export function requestBodyLimit(request: Request, url: URL): number {
  const uploadAction =
    request.method === 'POST' &&
    url.pathname.replace(/\/+$/, '') === '/app/library' &&
    url.searchParams.has('/upload');
  return uploadAction ? 11 * 1024 * 1024 : MAX_REQUEST_BODY_BYTES;
}

export async function limitRequestBody(
  request: Request,
  maxBytes = MAX_REQUEST_BODY_BYTES
): Promise<Request> {
  if (!request.body || request.method === 'GET' || request.method === 'HEAD')
    return request;
  let length = 0;
  const chunks: Uint8Array[] = [];
  const reader = request.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        // Cancelling destroys the Node socket before the 413 can be sent.
        // The adapter drains unread bytes after sending the response.
        throw new StudyError('REQUEST_BODY_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  // Check before framework body parsers can turn size failures into 400/500.
  return new Request(request, { body: Buffer.concat(chunks, length) });
}
