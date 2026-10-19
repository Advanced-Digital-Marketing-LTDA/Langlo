import * as Sentry from '@sentry/sveltekit';

type SpanAttributes = Record<string, string | number | boolean>;
type ActiveSpan = Parameters<Parameters<typeof Sentry.startSpan>[1]>[0];

/**
 * Time one async step as a span so a trace shows where a request waits, which
 * the SDK does not do for database calls. Attributes carry counts or sizes;
 * never learner content or identifiers. Errors propagate unchanged.
 */
export function span<T>(
  name: string,
  run: (active: ActiveSpan) => Promise<T>,
  attributes?: SpanAttributes
): Promise<T> {
  return Sentry.startSpan({ name, op: 'langlo.step', attributes }, run);
}
