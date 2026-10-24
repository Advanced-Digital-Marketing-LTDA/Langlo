import {
  error,
  fail,
  isHttpError,
  json,
  type RequestEvent
} from '@sveltejs/kit';
import type { Client } from '@libsql/client';
import { openAppDatabase } from './db/app';
import { FlashcardError } from './flashcards';
import {
  requireLearnerApi,
  requireLearnerPage,
  type LearnerSession
} from './learner-session';
import { StudyError } from './study';
import { span } from './tracing';

type LearnerEvent = Pick<RequestEvent, 'locals' | 'request'>;

// Repository codes mapped to the HTTP answer a learner sees. A row the caller
// does not own is indistinguishable from one that does not exist.
const statusFor: Record<string, number> = {
  NOT_FOUND: 404,
  IDEMPOTENCY_CONFLICT: 409,
  ALREADY_ENROLLED: 409,
  STALE_REVIEW: 409,
  NOT_APPROVED: 409,
  NOT_ELIGIBLE: 409,
  NOT_CONFIRMED: 409,
  NOT_A_MISTAKE: 409,
  NOT_EDITABLE: 409,
  SUSPENDED: 409,
  SESSION_NOT_ACTIVE: 409,
  CONTENT_UNAVAILABLE: 409,
  QUESTION_ALREADY_ANSWERED: 409,
  STALE_QUESTION: 409,
  RESULTS_NOT_READY: 409,
  RESULTS_PENDING: 409,
  ASSESSMENT_MODE: 409,
  STALE_GRAMMAR_RATING: 409,
  STALE_GRAMMAR_REVIEW: 409,
  REPORT_LIMIT: 429,
  LIBRARY_FILE_TOO_LARGE: 413,
  LIBRARY_PARSE_TIMEOUT: 422,
  LIBRARY_AI_UNAVAILABLE: 503,
  LIBRARY_AI_LIMIT: 429,
  LIBRARY_PARSE_BUSY: 429,
  LIBRARY_CONTEXT_TOO_LARGE: 413,
  LIBRARY_VOCABULARY_CHANGED: 409,
  INVALID_LIBRARY_ACTION: 400
};

// Codes whose cause the learner can act on get their own message; the rest
// share the generic text for their status.
const messageForCode: Record<string, string> = {
  ALREADY_ENROLLED: 'You are already enrolled in this track.',
  INVALID_DECK: 'Give the deck a name of up to 160 characters.',
  INVALID_DECK_LANGUAGE: 'Choose one of your languages for the deck.',
  INVALID_CONTENT:
    'Fill in both sides of a basic note, or the text of a cloze note (up to 4096 characters each).',
  INVALID_CLOZE:
    'A cloze note needs one hidden part like {{c1::answer}} and no other cloze numbers.',
  INVALID_RATING: 'Choose again, hard, good or easy.',
  INVALID_GRAMMAR_RATING: 'Choose Hard, Good, or Easy for a correct answer.',
  INVALID_FORMAT: 'Choose a basic front/back card or a cloze card.',
  INVALID_EXPLANATION: 'Keep the explanation within 1000 characters.',
  INVALID_SOURCE:
    'A generated card must carry its practice attempt, skill and content version.',
  STALE_REVIEW:
    'This card changed in another tab. Reload to see the current version before rating it again.',
  STALE_GRAMMAR_RATING:
    'This answer was already rated or is no longer available. Reload to continue.',
  STALE_GRAMMAR_REVIEW:
    'The due topics changed. Reload to choose from the current review queue.',
  NOT_ELIGIBLE:
    'Only a confirmed incorrect practice answer can become a flashcard.',
  NOT_CONFIRMED: 'This answer is still being checked. Try again shortly.',
  NOT_A_MISTAKE: 'Correct answers do not create mistake cards.',
  NOT_EDITABLE: 'A rejected card cannot be edited.',
  INVALID_TIMEZONE: 'Choose a valid timezone, for example Europe/Lisbon.',
  INVALID_STUDY_SCHEDULE:
    'Choose retention from 70% to 97% and one of the available study presets.',
  INVALID_TAGS: 'Use up to 20 tags, with no tag longer than 64 characters.',
  INVALID_SEARCH: 'Keep the search within 100 characters.',
  INVALID_ENROLLMENT: 'Choose a track, a starting level and a lesson language.',
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
  REPORT_LIMIT: 'You have reached the daily report limit. Try again tomorrow.',
  INVALID_LIBRARY_FILE: 'Upload a TXT, text-based PDF, DOCX, or EPUB file.',
  INVALID_LIBRARY_DOCUMENT:
    'This document has no readable text. Scanned PDFs and unreadable files are not supported.',
  INVALID_LIBRARY_LANGUAGE: 'Choose a supported document language.',
  INVALID_LIBRARY_TITLE: 'Use a title of up to 160 characters.',
  INVALID_LIBRARY_DECK: 'Choose a deck for this document’s language.',
  LIBRARY_VOCABULARY_CHANGED:
    'This vocabulary card was edited or moved. Manage the existing card in Decks.',
  INVALID_LIBRARY_TERM: 'Choose a word or phrase from the document.',
  INVALID_LIBRARY_DEFINITION: 'Enter a definition of up to 4096 characters.',
  INVALID_LIBRARY_PROGRESS: 'Choose a sentence in this document.',
  INVALID_LIBRARY_ACTION: 'Choose translation or vocabulary lookup.',
  LIBRARY_FILE_TOO_LARGE: 'Choose a file smaller than 10 MB.',
  LIBRARY_PARSE_TIMEOUT:
    'This document could not be read within the supported limits.',
  LIBRARY_AI_UNAVAILABLE:
    'Translation and vocabulary lookup are unavailable right now. Please try again later.',
  LIBRARY_AI_LIMIT: 'Daily Library AI limit reached. Try again tomorrow.',
  LIBRARY_PARSE_BUSY:
    'The Library is processing other uploads. Try again in a moment.',
  LIBRARY_CONTEXT_TOO_LARGE:
    'This sentence and its context are too long to send for study.'
};

function httpStatusFor(code: string): number | undefined {
  if (Object.hasOwn(statusFor, code)) return statusFor[code];
  if (code.startsWith('INVALID')) return 400;
  return undefined;
}

const messageFor: Record<number, string> = {
  400: 'Invalid request.',
  404: 'Not found.',
  409: 'This change conflicts with the current state.',
  413: 'This request is too large.',
  422: 'This request could not be processed.',
  503: 'This feature is not available right now.'
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
    error(503, 'Study data is not available yet.');
  const { client, close } = await span('study.open-database', () =>
    openAppDatabase(config)
  );
  try {
    return json(await span('study.run', () => run(client, learner)), {
      status
    });
  } catch (error_) {
    if (error_ instanceof FlashcardError || error_ instanceof StudyError) {
      const described = describeLearnerError(error_.code);
      if (described) error(described.status, described.message);
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
    error(400, messageFor[400]);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    error(400, messageFor[400]);
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
    error(503, 'Study data is not available yet.');
  const { client, close } = await span('study.open-database', () =>
    openAppDatabase(config)
  );
  try {
    return await span('study.run', () => run(client, learner));
  } catch (thrown) {
    const described =
      (thrown instanceof StudyError || thrown instanceof FlashcardError) &&
      describeLearnerError(thrown.code);
    if (described) error(described.status, described.message);
    throw thrown;
  } finally {
    close();
  }
}

/**
 * Run a form action's work: 4xx repository failures come back as a form
 * failure the page can show, anything else is rethrown. On success the given
 * value is returned.
 */
export async function formResult<T>(run: () => Promise<unknown>, success: T) {
  try {
    await run();
  } catch (thrown) {
    if (isHttpError(thrown) && thrown.status < 500)
      return fail(thrown.status, { message: thrown.body.message });
    throw thrown;
  }
  return success;
}

/**
 * A learner form action: the caller must be signed in (401 otherwise), the
 * work runs on the study database, and 4xx failures come back to the form.
 */
export function studyForm<T>(
  event: Pick<RequestEvent, 'locals'>,
  run: (client: Client, learner: LearnerSession) => Promise<unknown>,
  success: T
) {
  requireLearnerApi(event);
  return formResult(() => studyPage(event, run), success);
}

/** A page form action that returns the result of its work to the caller. */
export async function studyFormValue<R, T>(
  event: Pick<RequestEvent, 'locals'>,
  run: (client: Client, learner: LearnerSession) => Promise<R>,
  success: (value: R) => T
): Promise<T | ReturnType<typeof fail>> {
  requireLearnerApi(event);
  try {
    return success(await studyPage(event, run));
  } catch (error_) {
    if (isHttpError(error_) && error_.status < 500)
      return fail(error_.status, { message: error_.body.message });
    throw error_;
  }
}
