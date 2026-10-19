const SESSION_COOKIES = new Set([
  'better-auth.session_token',
  '__Secure-better-auth.session_token'
]);

/** Bounds the lookups one request can trigger (each is a database read). */
export const MAX_SESSION_COOKIES = 4;

type SessionLookup<T> = (input: { headers: Headers }) => Promise<T | null>;

/**
 * Better Auth reads only the first session cookie of a given name. A browser
 * can hold a stale duplicate (different Domain or Path) that is sent ahead of
 * the fresh one, which looks like a missing session. Try each duplicate on its
 * own and use the first that resolves; a lookup failure still propagates so a
 * backend outage is never reported as signed out.
 */
export async function lookupSession<T>(
  getSession: SessionLookup<T>,
  headers: Headers
): Promise<T | null> {
  const parts = (headers.get('cookie') ?? '').split(';').map((p) => p.trim());
  const isSession = (part: string) =>
    SESSION_COOKIES.has(part.slice(0, Math.max(part.indexOf('='), 0)));
  const sessionParts = parts.filter(isSession);
  if (sessionParts.length < 2) return getSession({ headers });
  for (const candidate of sessionParts.slice(0, MAX_SESSION_COOKIES)) {
    const narrowed = new Headers(headers);
    narrowed.set(
      'cookie',
      parts.filter((p) => !isSession(p) || p === candidate).join('; ')
    );
    const session = await getSession({ headers: narrowed });
    if (session) return session;
  }
  return null;
}
