import * as Sentry from '@sentry/sveltekit';

type SpanAttributes = Record<string, number | boolean>;
/** Only numbers and flags can be attached from a step, never text. */
type CountSetter = { setAttribute(key: string, value: number | boolean): void };

/**
 * Time one async step as a span so a trace shows where a request waits, which
 * the SDK does not do for database calls. Attributes carry counts or sizes;
 * never learner content or identifiers. Errors propagate unchanged.
 */
export function span<T>(
  name: string,
  run: (active: CountSetter) => Promise<T>,
  attributes?: SpanAttributes
): Promise<T> {
  return Sentry.startSpan({ name, op: 'langlo.step', attributes }, run);
}
