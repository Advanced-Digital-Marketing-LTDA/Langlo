import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDisposableFixture,
  disposeDisposableFixture
} from './fixtures/database';
import { migrateFixtureDatabase } from '../src/lib/server/db/migrate';
import {
  openFixtureDatabase,
  type FixtureTarget
} from '../src/lib/server/db/connection';
import { createAuth } from '../src/lib/server/auth';
import { CaptureMailer } from '../src/lib/server/mail';
import { provisionAccount } from '../src/lib/server/accounts';

const PASSWORD = 'correct-horse-battery-1';

let target: FixtureTarget;
let db: Awaited<ReturnType<typeof openFixtureDatabase>>['db'];
beforeAll(async () => {
  target = await createDisposableFixture();
  await migrateFixtureDatabase(target);
  db = (await openFixtureDatabase(target)).db;
});
afterAll(() => disposeDisposableFixture(target));

async function signIn(origin: string) {
  const auth = createAuth(
    {
      environment: 'test',
      origin,
      dataEnabled: true,
      databaseUrl: target.databaseUrl,
      revision: 't',
      auth: {
        secret: 'test-only-auth-secret-0000000000000000',
        mail: { transport: 'capture', smtpHost: 'l', smtpPort: 587 }
      }
    },
    { db, mailer: new CaptureMailer() }
  );
  const account = await provisionAccount(auth, {
    email: `${crypto.randomUUID()}@example.test`,
    name: 'A',
    password: PASSWORD
  });
  const response = await auth.handler(
    new Request(`${origin}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin,
        'x-langlo-client-address': '127.0.0.1'
      },
      body: JSON.stringify({ email: account.email, password: PASSWORD })
    })
  );
  return { auth, setCookies: response.headers.getSetCookie() };
}

const pair = (header: string) => header.split(';')[0];

describe('session cookie name', () => {
  it('is a __Host- cookie on HTTPS: Secure, Path=/, no Domain', async () => {
    const { auth, setCookies } = await signIn('https://langlo.example');
    expect(setCookies.map((c) => pair(c).split('=')[0])).toEqual([
      '__Host-langlo.session_token'
    ]);
    expect(setCookies[0]).toContain('Secure');
    expect(setCookies[0]).toContain('Path=/');
    expect(setCookies[0]).not.toMatch(/Domain=/iu);
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: pair(setCookies[0]) })
    });
    expect(session?.user).toBeTruthy();
  });

  it('ignores a legacy __Secure- session cookie on HTTPS', async () => {
    const { auth, setCookies } = await signIn('https://langlo.example');
    const legacy = pair(setCookies[0]).replace(
      '__Host-langlo.session_token',
      '__Secure-better-auth.session_token'
    );
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: legacy })
    });
    expect(session).toBeNull();
  });

  it('keeps the plain cookie name on HTTP', async () => {
    const { setCookies } = await signIn('http://localhost:3000');
    expect(setCookies.map((c) => pair(c).split('=')[0])).toEqual([
      'better-auth.session_token'
    ]);
  });
});
