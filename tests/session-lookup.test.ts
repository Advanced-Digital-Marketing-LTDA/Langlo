import { describe, expect, it, vi } from 'vitest';
import { lookupSession } from '../src/lib/server/session-lookup';

const NAME = '__Secure-better-auth.session_token';
const session = { user: { id: 'u1' }, session: { id: 's1' } };

/** Stands in for Better Auth: only the cookie value "good" has a session. */
const getSession = vi.fn(async ({ headers }: { headers: Headers }) => {
  const cookies = (headers.get('cookie') ?? '').split('; ');
  const token = cookies
    .find((c) => c.startsWith(`${NAME}=`))
    ?.slice(NAME.length + 1);
  return token === 'good' ? session : null;
});

const headersWith = (cookie: string) => new Headers({ cookie });

describe('lookupSession', () => {
  it('uses a valid session cookie that follows a stale duplicate', async () => {
    getSession.mockClear();
    const result = await lookupSession(
      getSession,
      headersWith(`${NAME}=stale; ${NAME}=good`)
    );
    expect(result).toBe(session);
  });

  it('uses a valid session cookie that precedes a stale duplicate', async () => {
    const result = await lookupSession(
      getSession,
      headersWith(`${NAME}=good; ${NAME}=stale`)
    );
    expect(result).toBe(session);
  });

  it('returns null when every duplicate is stale', async () => {
    const result = await lookupSession(
      getSession,
      headersWith(`${NAME}=stale; ${NAME}=old`)
    );
    expect(result).toBeNull();
  });

  it('looks up a single cookie once, with the original headers', async () => {
    getSession.mockClear();
    const headers = headersWith(`theme=dark; ${NAME}=good`);
    expect(await lookupSession(getSession, headers)).toBe(session);
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(getSession.mock.calls[0][0].headers).toBe(headers);
  });

  it('keeps unrelated cookies when trying each duplicate', async () => {
    const seen: string[] = [];
    await lookupSession(
      async ({ headers }) => {
        seen.push(headers.get('cookie') ?? '');
        return null;
      },
      headersWith(`${NAME}=a; theme=dark; ${NAME}=b`)
    );
    expect(seen).toEqual([`${NAME}=a; theme=dark`, `theme=dark; ${NAME}=b`]);
  });

  it('propagates a backend failure instead of treating it as no session', async () => {
    const outage = new Error('database unavailable');
    await expect(
      lookupSession(
        () => Promise.reject(outage),
        headersWith(`${NAME}=stale; ${NAME}=good`)
      )
    ).rejects.toBe(outage);
  });
});
