import {
  ProviderError,
  type DecisionRequest,
  type DecisionsProvider
} from './fallback';

export const DECISIONS_URL = new URL('https://api.openai.com/v1/decisions');

/** The OpenAI Decisions API over plain fetch; non-OK statuses and network failures throw ProviderError. */
export function openAiDecisions(
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): DecisionsProvider {
  return async (request: DecisionRequest, signal: AbortSignal) => {
    let response: Response;
    try {
      response = await fetchImpl(DECISIONS_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify(request),
        signal
      });
    } catch {
      if (signal.aborted) throw signal.reason;
      throw new ProviderError('network');
    }
    if (!response.ok) throw new ProviderError(response.status);
    try {
      return (await response.json()) as unknown;
    } catch {
      if (signal.aborted) throw signal.reason;
      // An unreadable body is malformed output, not a transport failure.
      return null;
    }
  };
}
