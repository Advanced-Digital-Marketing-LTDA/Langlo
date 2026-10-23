import type { Client } from '@libsql/client';
import type { RuntimeConfig } from '../config';
import {
  evaluateFallback,
  type FallbackInput,
  type FallbackResult
} from './fallback';
import { typesafeJev } from './typesafe-jev';
import { typesafeUsage } from './usage';

export type FallbackEvaluator = (
  input: FallbackInput
) => Promise<FallbackResult>;

/** The configured AI fallback, or undefined when no TypeSafe API key is set. */
export function fallbackEvaluator(
  client: Client,
  config:
    Pick<RuntimeConfig, 'typesafeApiKey' | 'typesafeApiKeyError'> | undefined
): FallbackEvaluator | undefined {
  if (config?.typesafeApiKeyError)
    console.error(
      JSON.stringify({
        level: 'error',
        operation: 'ai-fallback',
        reason: 'invalid-config',
        variable: config.typesafeApiKeyError.variable
      })
    );
  const key = config?.typesafeApiKey;
  if (!key) return undefined;
  const provider = typesafeJev(key);
  const usage = typesafeUsage(client);
  return (input) => evaluateFallback(input, provider, usage);
}
