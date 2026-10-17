import type { Client } from '@libsql/client';
import type { RuntimeConfig } from '../config';
import {
  evaluateFallback,
  type FallbackInput,
  type FallbackResult
} from './fallback';
import { openAiDecisions } from './openai-decisions';
import { decisionsUsage } from './usage';

export type FallbackEvaluator = (
  input: FallbackInput
) => Promise<FallbackResult>;

/** The configured AI fallback, or undefined when no OpenAI key is set. */
export function fallbackEvaluator(
  client: Client,
  config: Pick<RuntimeConfig, 'openAiKey'> | undefined
): FallbackEvaluator | undefined {
  const key = config?.openAiKey;
  if (!key) return undefined;
  const provider = openAiDecisions(key);
  const usage = decisionsUsage(client);
  return (input) => evaluateFallback(input, provider, usage);
}
