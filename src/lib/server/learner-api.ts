import { error, json, type RequestEvent } from '@sveltejs/kit';
import type { Client } from '@libsql/client';
import { openAppDatabase } from './db/app';
import { FlashcardError } from './flashcards';
import { requireLearnerApi, type LearnerSession } from './learner-session';
import { StudyError } from './study';

type LearnerEvent = Pick<RequestEvent, 'locals' | 'request'>;

// Repository codes mapped to the HTTP answer a learner sees. A row the caller
// does not own is indistinguishable from one that does not exist.
const statusFor: Record<string, number> = {
  NOT_FOUND: 404,
  IDEMPOTENCY_CONFLICT: 409,
  STALE_REVIEW: 409,
  NOT_APPROVED: 409,
  SUSPENDED: 409,
  SESSION_NOT_ACTIVE: 409,
  CONTENT_UNAVAILABLE: 409
};

function httpStatusFor(code: string): number | undefined {
  if (Object.hasOwn(statusFor, code)) return statusFor[code];
  if (code.startsWith('INVALID')) return 400;
  return undefined;
}

const messageFor: Record<number, string> = {
  400: 'Invalid request.',
  404: 'Not found.',
  409: 'This change conflicts with the current state.'
};

/**
 * Run a private endpoint for the learner the auth hook verified. The learner
 * is never read from params, query or body; repository errors become safe
 * status codes and the connection is always closed.
 */
export async function learnerApi(
  event: LearnerEvent,
  run: (client: Client, learner: LearnerSession) => Promise<unknown>,
  status = 200
): Promise<Response> {
  const learner = requireLearnerApi(event);
  const config = event.locals.config;
  if (!config?.dataEnabled || !config.databaseUrl)
    error(503, { message: 'Study data is not available yet.' });
  const { client, close } = await openAppDatabase(config);
  try {
    return json(await run(client, learner), { status });
  } catch (error_) {
    if (error_ instanceof FlashcardError || error_ instanceof StudyError) {
      const code = httpStatusFor(error_.code);
      if (code) error(code, { message: messageFor[code] });
    }
    throw error_;
  } finally {
    close();
  }
}

/** Parse a JSON object body; anything else is a 400 before any query runs. */
export async function readJsonObject(
  request: Request
): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    error(400, { message: messageFor[400] });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    error(400, { message: messageFor[400] });
  return body as Record<string, unknown>;
}

/** Drop the owner column: responses carry no learner identifiers. */
export function withoutOwner<T extends { ownerId?: unknown }>(
  row: T
): Omit<T, 'ownerId'> {
  const rest: Partial<T> = { ...row };
  delete rest.ownerId;
  return rest as Omit<T, 'ownerId'>;
}
