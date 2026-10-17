import type { Client } from '@libsql/client';
import { MONTHLY_CALL_CAP, type FallbackUsage } from './fallback';

/** The UTC calendar month a call is counted in, as "YYYY-MM". */
export const usageMonth = (now: number) =>
  new Date(now).toISOString().slice(0, 7);

/**
 * Monthly Decisions API counter. Reserving is one atomic statement, so
 * concurrent requests cannot overrun the cap.
 */
export function decisionsUsage(
  client: Client,
  now: () => number = Date.now,
  cap: number = MONTHLY_CALL_CAP
): FallbackUsage {
  let month = '';
  return {
    reserve: async () => {
      month = usageMonth(now());
      const reserved = await client.execute({
        sql: "INSERT INTO ai_usage (month, api, calls) VALUES (?, 'decisions', 1) ON CONFLICT (month, api) DO UPDATE SET calls = calls + 1 WHERE calls < ?",
        args: [month, cap]
      });
      return reserved.rowsAffected === 1;
    },
    record: async ({ inputTokens, outputTokens }) => {
      await client.execute({
        sql: "UPDATE ai_usage SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ? WHERE month = ? AND api = 'decisions'",
        args: [inputTokens, outputTokens, month]
      });
    }
  };
}
