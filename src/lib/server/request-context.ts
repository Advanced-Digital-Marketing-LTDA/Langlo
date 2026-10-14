import { AsyncLocalStorage } from 'node:async_hooks';

const correlationIds = new AsyncLocalStorage<string>();

export const withCorrelationId = <T>(correlationId: string, work: () => T): T =>
  correlationIds.run(correlationId, work);

export const currentCorrelationId = (): string =>
  correlationIds.getStore() ?? '';
