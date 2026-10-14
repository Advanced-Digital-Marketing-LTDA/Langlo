import { AsyncLocalStorage } from 'node:async_hooks';

const correlationIds = new AsyncLocalStorage<string>();

/** Preserve the server request ID across asynchronous auth and page work. */
export const withCorrelationId = <T>(correlationId: string, work: () => T): T =>
  correlationIds.run(correlationId, work);

/** Return the active request ID, or an empty value outside request scope. */
export const currentCorrelationId = (): string =>
  correlationIds.getStore() ?? '';
