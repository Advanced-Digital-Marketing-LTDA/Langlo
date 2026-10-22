import { ProviderError, type SystemOneProvider } from './fallback';

export const SYSTEM_ONE_URL = new URL('https://api.typesafe.ai/v1/systemone');

/** TypeSafe System One over fetch; transport failures never become verdicts. */
export function typesafeJev(
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): SystemOneProvider {
  return async (request, signal) => {
    let response: Response;
    try {
      response = await fetchImpl(SYSTEM_ONE_URL, {
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
      return null;
    }
  };
}
