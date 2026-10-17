type EventRecord = Record<string, unknown>;

function record(value: unknown): EventRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as EventRecord)
    : undefined;
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
    const path = url.pathname
      .split('/')
      .map((part) =>
        part.length > 0 &&
        (part.includes('@') ||
          part.includes('%') ||
          /^\d+$/u.test(part) ||
          /^[\da-f]{8}-[\da-f-]{27,}$/iu.test(part) ||
          /^[\da-z_-]{32,}$/iu.test(part))
          ? ':id'
          : part
      )
      .join('/');
    return url.origin === base ? path : `${url.origin}${path}`;
  } catch {
    return undefined;
  }
}

function safeBreadcrumb(value: unknown): EventRecord | undefined {
  const breadcrumb = record(value);
  if (!breadcrumb) return undefined;

  const safe: EventRecord = {};
  for (const key of ['timestamp', 'category', 'level', 'type']) {
    if (key in breadcrumb) safe[key] = breadcrumb[key];
  }
  return safe;
}

function safeException(value: unknown): EventRecord | undefined {
  const exception = record(value);
  if (!exception || !Array.isArray(exception.values)) return undefined;

  const values = exception.values.flatMap((value) => {
    const item = record(value);
    if (!item) return [];

    const safe: EventRecord = {};
    if (typeof item.type === 'string') safe.type = item.type;
    const stacktrace = record(item.stacktrace);
    const frames = Array.isArray(stacktrace?.frames)
      ? stacktrace.frames.flatMap((frame) => {
          const frameRecord = record(frame);
          if (!frameRecord) return [];
          const safeFrame: EventRecord = {};
          for (const key of [
            'filename',
            'function',
            'module',
            'lineno',
            'colno',
            'in_app'
          ]) {
            if (key in frameRecord) safeFrame[key] = frameRecord[key];
          }
          return [safeFrame];
        })
      : undefined;
    if (frames) safe.stacktrace = { frames };
    return [safe];
  });
  return { values };
}

type TelemetrySpan = EventRecord & {
  trace_id: string;
  span_id: string;
  name: string;
  start_timestamp: number;
  status: string;
  is_segment: boolean;
  attributes: EventRecord;
};

const httpMethods = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS'
]);
const spanOperations = new Set([
  'http.server',
  'http.client',
  'db',
  'db.sql.query',
  'ui.load',
  'ui.interaction',
  'function',
  'queue.process'
]);

function safeSpanName(value: string): string {
  const methodPath = /^([A-Z]+)\s+(\S+)$/u.exec(value);
  if (methodPath && httpMethods.has(methodPath[1])) {
    const location = safeLocation(methodPath[2]);
    if (location) return `${methodPath[1]} ${location}`;
  }
  return spanOperations.has(value) ? value : 'operation';
}

export function scrubTelemetrySpan<T extends object>(span: T): T {
  const source = span as unknown as TelemetrySpan;
  const attributes: EventRecord = {};
  const safeKeys = [
    'sentry.op',
    'http.request.method',
    'http.response.status_code'
  ];
  for (const key of safeKeys) {
    const value = source.attributes[key];
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
    const location = safeLocation(source.attributes[key]);
    if (location) attributes[key] = location;
  }

  return {
    trace_id: source.trace_id,
    ...(typeof source.parent_span_id === 'string'
      ? { parent_span_id: source.parent_span_id }
      : {}),
    span_id: source.span_id,
    name: safeSpanName(source.name),
    start_timestamp: source.start_timestamp,
    ...(typeof source.end_timestamp === 'number'
      ? { end_timestamp: source.end_timestamp }
      : {}),
    status: source.status,
    is_segment: source.is_segment,
    attributes
  } as T;
}

export function scrubTelemetryEvent<T extends object>(event: T): T {
  const scrubbed = structuredClone(event) as unknown as EventRecord;
  const request = record(scrubbed.request);
  const requestUrl = safeLocation(request?.url);
  const safeRequest = request
    ? {
        ...(requestUrl ? { url: requestUrl } : {}),
        ...(typeof request.method === 'string'
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
  const transaction = safeLocation(scrubbed.transaction);

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
        'transaction'
      ].includes(key)
    ) {
      delete scrubbed[key];
    }
  }
  if (breadcrumbs) scrubbed.breadcrumbs = breadcrumbs;
  if (exception) scrubbed.exception = exception;
  if (transaction) scrubbed.transaction = transaction;
  if (safeRequest) scrubbed.request = safeRequest;
  return scrubbed as T;
}
