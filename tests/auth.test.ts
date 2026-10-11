import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createDisposableFixture,
  disposeDisposableFixture
} from './fixtures/database';
import { migrateFixtureDatabase } from '../src/lib/server/db/migrate';
import {
  openFixtureDatabase,
  type FixtureTarget
} from '../src/lib/server/db/connection';
import { seedStudy } from './fixtures/study';
import { createAuth, type Auth } from '../src/lib/server/auth';
import { provisionAccount } from '../src/lib/server/accounts';
import { CaptureMailer } from '../src/lib/server/mail';
import {
  createDeck,
  createNote,
  getNote,
  FlashcardError
} from '../src/lib/server/flashcards';
import type { RuntimeConfig } from '../src/lib/server/config';

const ORIGIN = 'http://localhost:3000';
const config = (databaseUrl: string): RuntimeConfig => ({
  environment: 'test',
  origin: ORIGIN,
  dataEnabled: true,
  databaseUrl,
  revision: 'test',
  auth: {
    secret: 'test-only-auth-secret-0000000000000000',
    mail: { transport: 'capture', smtpHost: 'localhost', smtpPort: 587 }
  }
});

interface Rig {
  target: FixtureTarget;
  auth: Auth;
  mailer: CaptureMailer;
  db: Awaited<ReturnType<typeof openFixtureDatabase>>['db'];
  client: Awaited<ReturnType<typeof openFixtureDatabase>>['client'];
  close: () => void;
}

async function rig(): Promise<Rig> {
  const target = await createDisposableFixture();
  try {
    await migrateFixtureDatabase(target);
    const { client, db, close } = await openFixtureDatabase(target);
    const mailer = new CaptureMailer();
    const auth = createAuth(config(target.databaseUrl), { db, mailer });
    return { target, auth, mailer, db, client, close };
  } catch (error) {
    await disposeDisposableFixture(target);
    throw error;
  }
}

interface Reply {
  status: number;
  json: unknown;
  setCookies: string[];
}

function call(
  auth: Auth,
  path: string,
  init?: { method?: string; body?: unknown; cookie?: string }
): Promise<Reply> {
  return auth
    .handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        method: init?.method ?? 'GET',
        headers: {
          ...(init?.body !== undefined
            ? { 'content-type': 'application/json' }
            : {}),
          ...(init?.cookie ? { cookie: init.cookie } : {})
        },
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined
      })
    )
    .then(async (response) => ({
      status: response.status,
      json: await response.json().catch(() => null),
      setCookies: response.headers.getSetCookie()
    }));
}

const sessionCookie = (reply: Reply): string =>
  reply.setCookies
    .map((header) => header.split(';')[0])
    .find((pair) => pair.startsWith('better-auth.session_token=')) ?? '';

async function signIn(auth: Auth, email: string, password: string) {
  return call(auth, '/sign-in/email', {
    method: 'POST',
    body: { email, password }
  });
}

async function mintResetToken(
  auth: Auth,
  userId: string,
  expiresAt: Date
): Promise<string> {
  const token = `minted-${crypto.randomUUID().replaceAll('-', '')}`;
  const context = await auth.$context;
  await context.internalAdapter.createVerificationValue({
    identifier: `reset-password:${token}`,
    value: userId,
    expiresAt
  });
  return token;
}

const resetTokenFromMail = (mailer: CaptureMailer, index = 0): string =>
  /\/reset-password\/([^?\s]+)/.exec(mailer.messages[index]?.text ?? '')?.[1] ??
  '';

const clearRateLimits = (rig: Rig) =>
  rig.client.execute('DELETE FROM rate_limits');

describe('sign-up closure and credential login', () => {
  let fixture: Rig;
  beforeAll(async () => {
    fixture = await rig();
    await provisionAccount(fixture.auth, {
      email: 'a@example.test',
      name: 'Learner A',
      password: 'correct-horse-battery-1'
    });
  });
  afterAll(async () => {
    fixture.close();
    await disposeDisposableFixture(fixture.target);
  });

  it('rejects public registration with no account side effects', async () => {
    const reply = await call(fixture.auth, '/sign-up/email', {
      method: 'POST',
      body: {
        email: 'intruder@example.test',
        password: 'attacker-chosen-1',
        name: 'Intruder'
      }
    });
    expect(reply.status).toBe(400);
    const users = await fixture.client.execute(
      "SELECT id FROM users WHERE email = 'intruder@example.test'"
    );
    expect(users.rows).toEqual([]);
  });

  it('returns the same credential failure for unknown email and wrong password', async () => {
    await clearRateLimits(fixture);
    const unknown = await signIn(
      fixture.auth,
      'ghost@example.test',
      'whatever-12345'
    );
    const wrong = await signIn(
      fixture.auth,
      'a@example.test',
      'wrong-password-9'
    );
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.json).toEqual(wrong.json);
    expect(unknown.setCookies).toEqual([]);
    expect(wrong.setCookies).toEqual([]);
  });

  it('creates a database session with hardened cookie attributes on success', async () => {
    await clearRateLimits(fixture);
    const reply = await signIn(
      fixture.auth,
      'a@example.test',
      'correct-horse-battery-1'
    );
    expect(reply.status).toBe(200);
    const header = reply.setCookies.find((cookie) =>
      cookie.startsWith('better-auth.session_token=')
    );
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Path=/');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Max-Age=604800');
    // Secure is asserted only on HTTPS origins (docs/auth.md §2); this
    // fixture origin is HTTP so it must be absent here.
    expect(header).not.toContain('Secure');
    const sessions = await fixture.client.execute(
      'SELECT user_id, expires_at FROM sessions'
    );
    expect(sessions.rows).toHaveLength(1);
    expect(Number(sessions.rows[0].expires_at)).toBeGreaterThan(Date.now());
    const me = await call(fixture.auth, '/get-session', {
      cookie: sessionCookie(reply)
    });
    expect(me.status).toBe(200);
    expect((me.json as { user: { email: string } }).user.email).toBe(
      'a@example.test'
    );
  });
});

describe('logout, expiry and ownership', () => {
  let fixture: Rig;
  let accountA: { userId: string };
  let accountB: { userId: string };
  beforeAll(async () => {
    fixture = await rig();
    await seedStudy(fixture.target);
    accountA = await provisionAccount(fixture.auth, {
      email: 'a@example.test',
      name: 'Learner A',
      password: 'password-for-a-000'
    });
    accountB = await provisionAccount(fixture.auth, {
      email: 'b@example.test',
      name: 'Learner B',
      password: 'password-for-b-000'
    });
  });
  afterAll(async () => {
    fixture.close();
    await disposeDisposableFixture(fixture.target);
  });

  it('revokes the session row and clears the cookie on sign-out', async () => {
    await clearRateLimits(fixture);
    const login = await signIn(
      fixture.auth,
      'a@example.test',
      'password-for-a-000'
    );
    const cookie = sessionCookie(login);
    const out = await call(fixture.auth, '/sign-out', {
      method: 'POST',
      body: {},
      cookie
    });
    expect(out.status).toBe(200);
    const cleared = out.setCookies.find((header) =>
      header.startsWith('better-auth.session_token=')
    );
    expect(cleared).toMatch(
      /Max-Age=0|Expires=Thu, 01 Jan 1970|session_token=;/
    );
    const sessions = await fixture.client.execute('SELECT id FROM sessions');
    expect(sessions.rows).toEqual([]);
    const me = await call(fixture.auth, '/get-session', { cookie });
    expect(me.json).toBeNull();
  });

  it('rejects sessions whose expiry has passed', async () => {
    await clearRateLimits(fixture);
    const login = await signIn(
      fixture.auth,
      'a@example.test',
      'password-for-a-000'
    );
    const cookie = sessionCookie(login);
    await fixture.client.execute(
      `UPDATE sessions SET expires_at = ${Date.now() - 1000}`
    );
    const me = await call(fixture.auth, '/get-session', { cookie });
    expect(me.json).toBeNull();
    await fixture.client.execute('DELETE FROM sessions');
  });

  it('scopes learner data to the authenticated account only', async () => {
    await clearRateLimits(fixture);
    const login = await signIn(
      fixture.auth,
      'a@example.test',
      'password-for-a-000'
    );
    const me = await call(fixture.auth, '/get-session', {
      cookie: sessionCookie(login)
    });
    const ownerId = (me.json as { user: { id: string } }).user.id;
    expect(ownerId).toBe(accountA.userId);

    const sessionA = { userId: ownerId };
    const sessionB = { userId: accountB.userId };
    await createDeck(fixture.client, sessionA, {
      id: 'deck-a-1',
      name: 'A private deck'
    });
    await createNote(fixture.client, sessionA, {
      id: 'note-a-1',
      sourceId: `langlo:v1:${'0'.repeat(64)}`,
      deckId: 'deck-a-1',
      kind: 'basic',
      content: { front: 'le', back: 'the (masc.)' }
    });
    // B cannot read A's note, cannot write into A's deck.
    await expect(
      getNote(fixture.client, sessionB, 'note-a-1')
    ).rejects.toBeInstanceOf(FlashcardError);
    await expect(
      createNote(fixture.client, sessionB, {
        id: 'note-b-forge',
        sourceId: `langlo:v1:${'1'.repeat(64)}`,
        deckId: 'deck-a-1',
        kind: 'basic',
        content: { front: 'x', back: 'y' }
      })
    ).rejects.toBeInstanceOf(FlashcardError);
    // A can read its own note; the seeded learners' records stay invisible
    // because the authenticated id maps only to session.userId.
    const own = await getNote(fixture.client, sessionA, 'note-a-1');
    expect(own.ownerId).toBe(ownerId);
    const seededAttempts = await fixture.client.execute(
      'SELECT COUNT(*) AS n FROM attempts WHERE owner_id = ?',
      [ownerId]
    );
    expect(Number(seededAttempts.rows[0].n)).toBe(0);
  });
});

describe('recovery lifecycle', () => {
  let fixture: Rig;
  let userId: string;
  beforeAll(async () => {
    fixture = await rig();
    const account = await provisionAccount(fixture.auth, {
      email: 'a@example.test',
      name: 'Learner A',
      password: 'original-password-1'
    });
    userId = account.userId;
  });
  afterAll(async () => {
    fixture.close();
    await disposeDisposableFixture(fixture.target);
  });

  it('responds identically for known and unknown addresses', async () => {
    await clearRateLimits(fixture);
    const known = await call(fixture.auth, '/request-password-reset', {
      method: 'POST',
      body: { email: 'a@example.test' }
    });
    const unknown = await call(fixture.auth, '/request-password-reset', {
      method: 'POST',
      body: { email: 'ghost@example.test' }
    });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.json).toEqual(unknown.json);
    // Exactly one delivery was attempted, to the real account only.
    expect(fixture.mailer.messages).toHaveLength(1);
    expect(fixture.mailer.messages[0].to).toBe('a@example.test');
  });

  it('stores the verification identifier hashed, never the raw token', async () => {
    const token = resetTokenFromMail(fixture.mailer);
    expect(token.length).toBeGreaterThan(10);
    const rows = await fixture.client.execute(
      'SELECT identifier, value, expires_at FROM verifications'
    );
    expect(rows.rows).toHaveLength(1);
    const stored = rows.rows[0];
    expect(String(stored.identifier)).not.toContain(token);
    expect(String(stored.identifier)).not.toBe(`reset-password:${token}`);
    expect(String(stored.value)).toBe(userId);
    expect(Number(stored.expires_at)).toBeGreaterThan(Date.now());
    // Cleanup so later tests are independent of request count.
    await fixture.client.execute('DELETE FROM verifications');
  });

  it('redeems a token once: reset revokes sessions and replay fails', async () => {
    await clearRateLimits(fixture);
    const login = await signIn(
      fixture.auth,
      'a@example.test',
      'original-password-1'
    );
    expect(login.status).toBe(200);
    const token = await mintResetToken(
      fixture.auth,
      userId,
      new Date(Date.now() + 1800_000)
    );
    const reset = await call(fixture.auth, '/reset-password', {
      method: 'POST',
      body: { token, newPassword: 'rotated-password-1' }
    });
    expect(reset.status).toBe(200);
    // revokeSessionsOnPasswordReset: the pre-reset session is gone.
    const sessions = await fixture.client.execute('SELECT id FROM sessions');
    expect(sessions.rows).toEqual([]);
    const replay = await call(fixture.auth, '/reset-password', {
      method: 'POST',
      body: { token, newPassword: 'another-attempt-1' }
    });
    expect(replay.status).toBe(400);
    const oldLogin = await signIn(
      fixture.auth,
      'a@example.test',
      'original-password-1'
    );
    expect(oldLogin.status).toBe(401);
    const newLogin = await signIn(
      fixture.auth,
      'a@example.test',
      'rotated-password-1'
    );
    expect(newLogin.status).toBe(200);
    await fixture.client.execute('DELETE FROM sessions');
  });

  it('permits exactly one winner under concurrent redemption', async () => {
    await clearRateLimits(fixture);
    const token = await mintResetToken(
      fixture.auth,
      userId,
      new Date(Date.now() + 1800_000)
    );
    const results = await Promise.all([
      call(fixture.auth, '/reset-password', {
        method: 'POST',
        body: { token, newPassword: 'concurrent-password-1' }
      }),
      call(fixture.auth, '/reset-password', {
        method: 'POST',
        body: { token, newPassword: 'concurrent-password-2' }
      })
    ]);
    expect(results.map((reply) => reply.status).sort()).toEqual([200, 400]);
    const first = await signIn(
      fixture.auth,
      'a@example.test',
      'concurrent-password-1'
    );
    const second = await signIn(
      fixture.auth,
      'a@example.test',
      'concurrent-password-2'
    );
    expect(first.status === 200).not.toBe(second.status === 200);
    await fixture.client.execute('DELETE FROM sessions');
  });

  it('rejects expired tokens', async () => {
    await clearRateLimits(fixture);
    const token = await mintResetToken(
      fixture.auth,
      userId,
      new Date(Date.now() - 1000)
    );
    const reply = await call(fixture.auth, '/reset-password', {
      method: 'POST',
      body: { token, newPassword: 'expired-attempt-1' }
    });
    expect(reply.status).toBe(400);
  });
});

describe('rate limiting and logging', () => {
  let fixture: Rig;
  beforeAll(async () => {
    fixture = await rig();
    await provisionAccount(fixture.auth, {
      email: 'a@example.test',
      name: 'Learner A',
      password: 'rate-limit-password-1'
    });
  });
  afterAll(async () => {
    fixture.close();
    await disposeDisposableFixture(fixture.target);
  });

  it('limits repeated sign-in attempts with database-backed counters', async () => {
    await clearRateLimits(fixture);
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      statuses.push(
        (await signIn(fixture.auth, 'a@example.test', 'rate-limit-password-1'))
          .status
      );
    }
    expect(statuses.slice(0, 5).every((status) => status === 200)).toBe(true);
    expect(statuses.slice(5).every((status) => status === 429)).toBe(true);
    const counters = await fixture.client.execute(
      "SELECT count FROM rate_limits WHERE key LIKE '%/sign-in/email'"
    );
    expect(counters.rows).toHaveLength(1);
    // Rejected requests do not inflate the counter; it saturates at the cap.
    expect(Number(counters.rows[0].count)).toBeGreaterThanOrEqual(5);
  });

  it('limits repeated recovery requests', async () => {
    await clearRateLimits(fixture);
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      statuses.push(
        (
          await call(fixture.auth, '/request-password-reset', {
            method: 'POST',
            body: { email: 'a@example.test' }
          })
        ).status
      );
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it('never writes credentials or tokens to the log stream', async () => {
    await clearRateLimits(fixture);
    const captured: string[] = [];
    const spy = vi
      .spyOn(console, 'warn')
      .mockImplementation((...args) => captured.push(args.join(' ')));
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation((...args) => captured.push(args.join(' ')));
    const logSpy = vi
      .spyOn(console, 'log')
      .mockImplementation((...args) => captured.push(args.join(' ')));
    try {
      const failing = new CaptureMailer();
      failing.send = () => Promise.reject(new Error('smtp refused'));
      const authWithFailingMail = createAuth(
        config(fixture.target.databaseUrl),
        { db: fixture.db, mailer: failing }
      );
      const sensitive = [
        'rate-limit-password-1',
        'a@example.test',
        'proton-token',
        'minted-'
      ];
      await call(authWithFailingMail, '/request-password-reset', {
        method: 'POST',
        body: { email: 'a@example.test' }
      });
      await signIn(fixture.auth, 'a@example.test', 'rate-limit-password-1');
      const minted = await mintResetToken(
        fixture.auth,
        (
          await fixture.client.execute(
            "SELECT id FROM users WHERE email = 'a@example.test'"
          )
        ).rows[0].id as string,
        new Date(Date.now() + 1800_000)
      );
      sensitive.push(minted);
      await call(fixture.auth, '/reset-password', {
        method: 'POST',
        body: { token: minted, newPassword: 'post-log-password-1' }
      });
      await call(fixture.auth, '/get-session');
      const transcript = captured.join('\n');
      for (const value of sensitive) {
        expect(transcript).not.toContain(value);
      }
    } finally {
      spy.mockRestore();
      errorSpy.mockRestore();
      logSpy.mockRestore();
    }
  });
});
