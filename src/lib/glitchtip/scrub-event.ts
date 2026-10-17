type EventRecord = Record<string, unknown>;

const httpMethods = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS'
]);
const breadcrumbCategories = new Set([
  'ui.click',
  'ui.input',
  'navigation',
  'http'
]);
const breadcrumbLevels = new Set([
  'fatal',
  'error',
  'warning',
  'log',
  'info',
  'debug'
]);
const breadcrumbTypes = new Set([
  'default',
  'debug',
  'error',
  'http',
  'info',
  'navigation',
  'query',
  'transaction',
  'ui',
  'user'
]);
const exceptionTypes = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
  'EvalError',
  'AggregateError',
  'DOMException',
  'NetworkError',
  'AbortError'
]);
// shortcut: new routes are omitted until added here; update this list with route files.
const routeTemplates = [
  '/',
  '/app',
  '/app/api/attempts',
  '/app/api/attempts/:id',
  '/app/api/cards/:id/reviews',
  '/app/api/decks',
  '/app/api/notes/:id',
  '/app/api/notes/:id/approve',
  '/app/api/study-sessions',
  '/app/api/study-sessions/:id',
  '/app/api/study-sessions/:id/next',
  '/app/api/study-sessions/:id/pause',
  '/app/api/study-sessions/:id/resume',
  '/app/assessment',
  '/app/assessment/:language',
  '/app/assessment/session/:id',
  '/app/assessment/session/:id/results',
  '/app/learn/:language/lesson/:skill',
  '/app/map',
  '/app/progress',
  '/app/reports',
  '/build.json',
  '/health/live',
  '/health/ready',
  '/help',
  '/login',
  '/privacy',
  '/prototype',
  '/prototype/decks',
  '/prototype/lesson',
  '/prototype/map',
  '/prototype/practice',
  '/prototype/results',
  '/prototype/review',
  '/prototype/settings',
  '/recover',
  '/reset',
  '/signup'
];

function record(value: unknown): EventRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as EventRecord)
    : undefined;
}

function safeRoute(pathname: string): string | undefined {
  const path = pathname.replace(/\/+$/u, '') || '/';
  const segments = path.split('/');
  return routeTemplates.find((template) => {
    const expected = template.split('/');
    return (
      expected.length === segments.length &&
      expected.every(
        (segment, index) =>
          segment.startsWith(':') || segment === segments[index]
      )
    );
  });
}

function safeLocation(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    (!value.startsWith('/') && !/^https?:\/\//iu.test(value))
  )
    return undefined;

  try {
    const base = 'https://relative.invalid';
    const url = new URL(value, base);
    const path = safeRoute(url.pathname);
    if (!path) return undefined;
    return url.origin === base ? path : `${url.origin}${path}`;
  } catch {
    return undefined;
  }
}

function safeFrameFilename(value: unknown): string | undefined {
  const location = safeLocation(value);
  if (location) return location;
  if (
    typeof value !== 'string' ||
    !/^\/_app\/immutable\/(?:assets|chunks|entry|nodes)\/[A-Za-z0-9._/-]+$/u.test(
      value
    ) ||
    value.split('/').some((segment) => segment === '.' || segment === '..')
  )
    return undefined;
  return value;
}

function safeTransaction(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const methodPath = /^([A-Z]+)\s+(\S+)$/u.exec(value);
  if (methodPath && httpMethods.has(methodPath[1])) {
    const location = safeLocation(methodPath[2]);
    return location ? `${methodPath[1]} ${location}` : undefined;
  }
  return safeLocation(value);
}

function safeBreadcrumb(value: unknown): EventRecord | undefined {
  const breadcrumb = record(value);
  if (!breadcrumb) return undefined;

  const safe: EventRecord = {};
  if (
    typeof breadcrumb.timestamp === 'number' &&
    Number.isFinite(breadcrumb.timestamp)
  )
    safe.timestamp = breadcrumb.timestamp;
  if (
    typeof breadcrumb.category === 'string' &&
    breadcrumbCategories.has(breadcrumb.category)
  )
    safe.category = breadcrumb.category;
  if (
    typeof breadcrumb.level === 'string' &&
    breadcrumbLevels.has(breadcrumb.level)
  )
    safe.level = breadcrumb.level;
  if (
    typeof breadcrumb.type === 'string' &&
    breadcrumbTypes.has(breadcrumb.type)
  )
    safe.type = breadcrumb.type;
  return safe;
}

function safeException(value: unknown): EventRecord | undefined {
  const exception = record(value);
  if (!exception || !Array.isArray(exception.values)) return undefined;

  const values = exception.values.flatMap((value) => {
    const item = record(value);
    if (!item) return [];

    const safe: EventRecord = {};
    if (typeof item.type === 'string' && exceptionTypes.has(item.type))
      safe.type = item.type;
    const stacktrace = record(item.stacktrace);
    const frames = Array.isArray(stacktrace?.frames)
      ? stacktrace.frames.flatMap((frame) => {
          const frameRecord = record(frame);
          if (!frameRecord) return [];
          const safeFrame: EventRecord = {};
          const filename = safeFrameFilename(frameRecord.filename);
          if (filename) safeFrame.filename = filename;
          for (const key of ['lineno', 'colno']) {
            const value = frameRecord[key];
            if (
              typeof value === 'number' &&
              Number.isInteger(value) &&
              value >= 0 &&
              value <= 10_000_000
            )
              safeFrame[key] = value;
          }
          if (typeof frameRecord.in_app === 'boolean')
            safeFrame.in_app = frameRecord.in_app;
          return [safeFrame];
        })
      : undefined;
    if (frames) safe.stacktrace = { frames };
    return [safe];
  });
  return { values };
}

const spanOperations = new Set([
  'http.server',
  'http.client',
  'db',
  'db.sql.query',
  'ui.load',
  'ui.interaction',
  'function',
  'queue.process',
  'pageload',
  'navigation',
  'navigation.redirect',
  'router',
  'handler',
  'middleware',
  'browser.cache',
  'browser.dns',
  'browser.connect',
  'browser.tls_ssl',
  'browser.redirect',
  'browser.request',
  'browser.response',
  'browser.unload_event',
  'browser.dom_content_loaded_event',
  'browser.load_event',
  'resource.script',
  'resource.css',
  'resource.img',
  'resource.other'
]);
const resourceSpanOperations = new Set([
  'resource.script',
  'resource.css',
  'resource.img',
  'resource.other'
]);
const safeSpanNames = new Set([
  'Cache lookup',
  'DNS lookup',
  'Connect',
  'TLS handshake',
  'Redirect',
  'Request',
  'Response',
  'Unload event',
  'DOMContentLoaded event',
  'Load event'
]);
const spanStatuses = new Set([
  'ok',
  'error',
  'deadline_exceeded',
  'unauthenticated',
  'permission_denied',
  'not_found',
  'resource_exhausted',
  'invalid_argument',
  'unimplemented',
  'unavailable',
  'internal_error',
  'unknown_error',
  'cancelled',
  'already_exists',
  'failed_precondition',
  'aborted',
  'out_of_range',
  'data_loss'
]);

function safeSpanName(value: string, operation: unknown): string {
  if (typeof operation === 'string' && resourceSpanOperations.has(operation))
    return operation;
  const methodPath = /^([A-Z]+)\s+(\S+)$/u.exec(value);
  if (methodPath && httpMethods.has(methodPath[1])) {
    const location = safeLocation(methodPath[2]);
    if (location) return `${methodPath[1]} ${location}`;
  }
  const location = safeLocation(value);
  if (location) return location;
  return spanOperations.has(value) || safeSpanNames.has(value)
    ? value
    : 'operation';
}

export function scrubTelemetrySpan<T extends object>(span: T): T {
  const source = span as unknown as EventRecord;
  const isStatic = source.attributes === undefined;
  const sourceAttributes =
    record(isStatic ? source.data : source.attributes) ?? {};
  const attributes: EventRecord = {};
  const safeKeys = [
    'sentry.op',
    'http.request.method',
    'http.response.status_code'
  ];
  for (const key of safeKeys) {
    const value = sourceAttributes[key];
    if (
      key === 'sentry.op' &&
      typeof value === 'string' &&
      spanOperations.has(value)
    )
      attributes[key] = value;
    if (
      key === 'http.request.method' &&
      typeof value === 'string' &&
      httpMethods.has(value)
    )
      attributes[key] = value;
    if (
      key === 'http.response.status_code' &&
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 100 &&
      value <= 599
    )
      attributes[key] = value;
  }
  for (const key of ['http.route', 'http.target', 'url.path']) {
    const location = safeLocation(sourceAttributes[key]);
    if (location) attributes[key] = location;
  }

  const operation = isStatic ? source.op : sourceAttributes['sentry.op'];
  const sourceName = isStatic ? source.description : source.name;
  const name =
    typeof sourceName === 'string'
      ? safeSpanName(sourceName, operation)
      : 'operation';
  const status =
    typeof source.status === 'string' && spanStatuses.has(source.status)
      ? source.status
      : undefined;
  if (isStatic) {
    return {
      trace_id: source.trace_id,
      ...(typeof source.parent_span_id === 'string'
        ? { parent_span_id: source.parent_span_id }
        : {}),
      span_id: source.span_id,
      ...(typeof operation === 'string' && spanOperations.has(operation)
        ? { op: operation }
        : {}),
      description: name,
      start_timestamp: source.start_timestamp,
      ...(typeof source.timestamp === 'number'
        ? { timestamp: source.timestamp }
        : {}),
      ...(status ? { status } : {}),
      ...(typeof source.is_segment === 'boolean'
        ? { is_segment: source.is_segment }
        : {}),
      data: attributes
    } as T;
  }

  return {
    trace_id: source.trace_id,
    ...(typeof source.parent_span_id === 'string'
      ? { parent_span_id: source.parent_span_id }
      : {}),
    span_id: source.span_id,
    name,
    start_timestamp: source.start_timestamp,
    ...(typeof source.end_timestamp === 'number'
      ? { end_timestamp: source.end_timestamp }
      : {}),
    ...(status ? { status } : {}),
    is_segment: source.is_segment,
    attributes
  } as T;
}

export function scrubTelemetryEvent<T extends object>(event: T): T {
  const scrubbed = structuredClone(event) as unknown as EventRecord;
  const isTransaction = scrubbed.type === 'transaction';
  const request = record(scrubbed.request);
  const requestUrl = safeLocation(request?.url);
  const safeRequest = request
    ? {
        ...(requestUrl ? { url: requestUrl } : {}),
        ...(typeof request.method === 'string' &&
        httpMethods.has(request.method)
          ? { method: request.method }
          : {})
      }
    : undefined;

  const breadcrumbs = Array.isArray(scrubbed.breadcrumbs)
    ? scrubbed.breadcrumbs.flatMap((breadcrumb) => {
        const safe = safeBreadcrumb(breadcrumb);
        return safe ? [safe] : [];
      })
    : undefined;
  const exception = safeException(scrubbed.exception);
  const transaction = safeTransaction(scrubbed.transaction);
  const safeTrace = record(record(scrubbed.contexts)?.trace);
  const trace: EventRecord = {};
  for (const key of ['trace_id', 'span_id', 'parent_span_id']) {
    const value = safeTrace?.[key];
    const length = key === 'trace_id' ? 32 : 16;
    if (
      typeof value === 'string' &&
      new RegExp(`^[a-f0-9]{${length}}$`, 'iu').test(value)
    )
      trace[key] = value;
  }
  if (typeof safeTrace?.op === 'string' && spanOperations.has(safeTrace.op))
    trace.op = safeTrace.op;
  if (
    typeof safeTrace?.status === 'string' &&
    spanStatuses.has(safeTrace.status)
  )
    trace.status = safeTrace.status;
  const contexts = Object.keys(trace).length ? { trace } : undefined;
  const spans =
    isTransaction && Array.isArray(scrubbed.spans)
      ? scrubbed.spans.flatMap((value) => {
          const span = record(value);
          if (
            !span ||
            typeof span.trace_id !== 'string' ||
            !/^[a-f0-9]{32}$/iu.test(span.trace_id) ||
            typeof span.span_id !== 'string' ||
            !/^[a-f0-9]{16}$/iu.test(span.span_id) ||
            typeof span.start_timestamp !== 'number' ||
            !Number.isFinite(span.start_timestamp)
          )
            return [];
          return [scrubTelemetrySpan(span)];
        })
      : undefined;

  for (const key of Object.keys(scrubbed)) {
    if (
      ![
        'event_id',
        'timestamp',
        'platform',
        'level',
        'environment',
        'release',
        'request',
        'breadcrumbs',
        'exception',
        'transaction',
        ...(isTransaction
          ? ['type', 'start_timestamp', 'contexts', 'spans']
          : [])
      ].includes(key)
    ) {
      delete scrubbed[key];
    }
  }
  if (breadcrumbs) scrubbed.breadcrumbs = breadcrumbs;
  else delete scrubbed.breadcrumbs;
  if (exception) scrubbed.exception = exception;
  else delete scrubbed.exception;
  if (transaction) scrubbed.transaction = transaction;
  else delete scrubbed.transaction;
  if (safeRequest) scrubbed.request = safeRequest;
  else delete scrubbed.request;
  if (isTransaction) {
    if (
      typeof scrubbed.start_timestamp !== 'number' ||
      !Number.isFinite(scrubbed.start_timestamp)
    )
      delete scrubbed.start_timestamp;
    if (contexts) scrubbed.contexts = contexts;
    else delete scrubbed.contexts;
    if (spans) scrubbed.spans = spans;
    else delete scrubbed.spans;
  }
  return scrubbed as T;
}
