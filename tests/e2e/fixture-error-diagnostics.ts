import { getGlobalScope } from '@sentry/sveltekit';

const kinds = new Set([
  'Error',
  'LibsqlError',
  'SqliteError',
  'TypeError',
  'RangeError',
  'SyntaxError'
]);
const codes = new Set([
  'SQLITE_BUSY',
  'SQLITE_BUSY_SNAPSHOT',
  'SQLITE_LOCKED',
  'SQLITE_ERROR',
  'SQLITE_CONSTRAINT',
  'SQLITE_CONSTRAINT_TRIGGER',
  'SQLITE_CONSTRAINT_CHECK',
  'SQLITE_CONSTRAINT_UNIQUE',
  'SQLITE_CONSTRAINT_FOREIGNKEY',
  'SQLITE_CONSTRAINT_NOTNULL',
  'TRANSACTION_ACTIVE',
  'TRANSACTION_CLOSED',
  'CLIENT_CLOSED'
]);
const frames = [
  'recordAnswer',
  'recordAttempt',
  'recordAttemptWrite',
  'insertAttempt',
  'recordPreparedEvaluation',
  'syncAttemptEvidence',
  'beginTransaction',
  'executeStmt'
];

/** Closed projection: no exception messages, arbitrary strings or stack paths. */
export function fixtureException(error: unknown) {
  const chain = [];
  for (
    let depth = 0;
    error && typeof error === 'object' && depth < 3;
    depth++
  ) {
    const value = error as {
      name?: unknown;
      code?: unknown;
      stack?: unknown;
      cause?: unknown;
    };
    chain.push({
      kind:
        typeof value.name === 'string' && kinds.has(value.name)
          ? value.name
          : 'Other',
      code:
        typeof value.code === 'string' && codes.has(value.code)
          ? value.code
          : undefined,
      frames: frames.filter(
        (frame) =>
          typeof value.stack === 'string' &&
          new RegExp('\\bat (?:async )?' + frame + '\\b').test(value.stack)
      )
    });
    error = value.cause;
  }
  return chain;
}

/** Discard arbitrary output; revalidate even our structured diagnostic records. */
export function readFixtureException(line: string) {
  const prefix = 'FIXTURE_SERVER_EXCEPTION ';
  if (!line.startsWith(prefix)) return;
  try {
    const rows = JSON.parse(line.slice(prefix.length));
    if (!Array.isArray(rows)) return;
    return rows.slice(0, 3).map((row) => ({
      kind: kinds.has(row?.kind) ? (row.kind as string) : 'Other',
      code: codes.has(row?.code) ? (row.code as string) : undefined,
      frames: frames.filter(
        (frame) => Array.isArray(row?.frames) && row.frames.includes(frame)
      )
    }));
  } catch {
    /* Malformed child output must not replace a test failure. */
  }
}

// Loaded only by the disposable exercise fixture server, before its error hook.
if (
  process.env.LANGLO_FIXTURE_ERROR_CAPTURE === '1' &&
  process.env.APP_ENV === 'test' &&
  process.env.DATABASE_URL?.startsWith('file:') &&
  process.env.MAIL_TRANSPORT === 'capture'
) {
  let count = 0;
  getGlobalScope().addEventProcessor((event, hint) => {
    if (hint.originalException && count++ < 10)
      console.error(
        'FIXTURE_SERVER_EXCEPTION ' +
          JSON.stringify(fixtureException(hint.originalException))
      );
    return event;
  });
}
