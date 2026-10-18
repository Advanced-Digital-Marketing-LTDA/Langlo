import { ConfigError, configVariables } from './config.ts';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const configVariableSet: ReadonlySet<string> = new Set(configVariables);

/** Project only operation, error category and a valid request UUID; never copy exception payloads. */
export function safeDiagnostic(
  operation: 'request' | 'configuration' | 'auth' | 'mail-delivery',
  error: unknown,
  correlationId: string
) {
  const variable =
    error instanceof ConfigError &&
    typeof error.variable === 'string' &&
    configVariableSet.has(error.variable)
      ? error.variable
      : undefined;
  return {
    operation,
    kind: error instanceof ConfigError ? 'configuration' : 'unexpected',
    correlationId: uuidPattern.test(correlationId) ? correlationId : undefined,
    ...(variable ? { variable } : {})
  };
}
/** Return fixed retry guidance and an optional validated UUID, without reflecting exception details. */
export function safeError(correlationId: string): {
  message: string;
  correlationId?: string;
} {
  return {
    message: 'Something went wrong. Please try again.',
    correlationId: uuidPattern.test(correlationId) ? correlationId : undefined
  };
}

const mailFailureCodes: ReadonlySet<string> = new Set([
  'ETIMEDOUT',
  'EAUTH',
  'ECONNECTION',
  'ECONNREFUSED',
  'ESOCKET',
  'ETLS',
  'EENVELOPE',
  'EDNS'
]);

/** Closed allowlist of transport error codes; anything else, and every message, is dropped. */
export function mailFailureCode(error: unknown): string | undefined {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  return typeof code === 'string' && mailFailureCodes.has(code)
    ? code
    : undefined;
}
