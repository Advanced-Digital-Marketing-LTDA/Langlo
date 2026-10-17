import { error, json, type RequestEvent } from '@sveltejs/kit';
import type { Client } from '@libsql/client';
import { openAppDatabase } from './db/app';
import { FlashcardError } from './flashcards';
import {
  requireLearnerApi,
  requireLearnerPage,
  type LearnerSession
} from './learner-session';
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
  CONTENT_UNAVAILABLE: 409,
  QUESTION_ALREADY_ANSWERED: 409,
  STALE_QUESTION: 409,
  RESULTS_NOT_READY: 409,
  RESULTS_PENDING: 409,
  ASSESSMENT_MODE: 409,
  REPORT_LIMIT: 429
};

// Codes whose cause the learner can act on get their own message; the rest
// share the generic text for their status.
const messageForCode: Record<string, string> = {
  INVALID_REPORT:
    'Choose a report category and keep the comment within 1000 characters.',
  SESSION_NOT_ACTIVE:
    'This session is paused or finished. Only a paused session can be resumed.',
  CONTENT_UNAVAILABLE: 'This content is not available right now.',
  QUESTION_ALREADY_ANSWERED:
    'This question was already answered in this session.',
  STALE_QUESTION: 'This question is out of date. Reload to continue.',
  RESULTS_NOT_READY: 'Assessment results are available only after completion.',
  RESULTS_PENDING:
    'Your last answer is still being checked. Reload in a few seconds.',
  ASSESSMENT_MODE:
    'Use the assessment page to continue. Lessons and feedback are hidden during assessments.',
  REPORT_LIMIT: 'You have reached the daily report limit. Try again tomorrow.'
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

/** The HTTP status and learner-safe message for a repository error code. */
export function describeLearnerError(
  code: string
): { status: number; message: string } | undefined {
  const status = httpStatusFor(code);
  if (!status) return undefined;
  return { status, message: messageForCode[code] ?? messageFor[status] };
}

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
      const described = describeLearnerError(error_.code);
      if (described) error(described.status, { message: described.message });
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

/** Authenticated study pages share the API's database and error boundaries. */
export async function studyPage<T>(
  event: Pick<RequestEvent, 'locals'>,
  run: (client: Client, learner: LearnerSession) => Promise<T>
): Promise<T> {
  const learner = requireLearnerPage(event);
  const config = event.locals.config;
  if (!config?.dataEnabled || !config.databaseUrl)
    error(503, { message: 'Study data is not available yet.' });
  const { client, close } = await openAppDatabase(config);
  try {
    return await run(client, learner);
  } catch (thrown) {
    const described =
      thrown instanceof StudyError && describeLearnerError(thrown.code);
    if (described) error(described.status, { message: described.message });
    throw thrown;
  } finally {
    close();
  }
}
