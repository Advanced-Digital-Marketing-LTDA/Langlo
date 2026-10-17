import { expect, type APIRequestContext, request } from '@playwright/test';
import { test } from './coverage-fixture';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { createClient } from '@libsql/client/sqlite3';
import {
  createFixtureDatabase,
  disposeFixtureDatabase,
  reservePort,
  runNode as run,
  waitForLive
} from './fixture-server';

/** Clear the supplied fixture's auth counters between independent limit checks. */
async function resetRateLimits(databaseFile: string): Promise<void> {
  const client = createClient({ url: `file://${databaseFile}` });
  try {
    await client.execute('DELETE FROM rate_limits');
  } finally {
    client.close();
  }
}

let server: ChildProcess;
let base = '';
let fixtureRoot = '';
let mailDir = '';
let dbFile = '';
let ctx: APIRequestContext;

const provisionEnv = () => ({
  ...process.env,
  APP_ENV: 'test',
  APP_ORIGIN: base,
  DATA_ENABLED: 'true',
  DATABASE_URL: `file://${dbFile}`,
  BETTER_AUTH_SECRET: 'e2e-only-auth-secret-0000000000000000',
  MAIL_TRANSPORT: 'capture',
  MAIL_CAPTURE_DIR: mailDir
});

test.beforeAll(async () => {
  // Dynamic port: avoids colliding with any already-running server.
  const port = await reservePort();
  base = `http://127.0.0.1:${port}`;
  ({ fixtureRoot, dbFile } = createFixtureDatabase());
  mailDir = await mkdtemp(join(await realpath(tmpdir()), 'langlo-mail-'));
  // Operator path end-to-end: real config parsing, real credential write.
  run(
    [
      'scripts/accounts-provision.ts',
      '--app',
      '--email',
      'e2e@example.test',
      '--name',
      'E2E Learner'
    ],
    'e2e-password-0000',
    provisionEnv()
  );
  server = spawn('node', ['build'], {
    cwd: process.cwd(),
    env: {
      ...provisionEnv(),
      HOST: '127.0.0.1',
      PORT: String(port),
      ORIGIN: base,
      PROTOCOL_HEADER: 'x-forwarded-proto'
    },
    stdio: 'ignore'
  });
  await waitForLive(base);
  ctx = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { 'x-forwarded-proto': 'http' }
  });
});

test.afterAll(async () => {
  await ctx?.dispose();
  server?.kill();
  await disposeFixtureDatabase(fixtureRoot, dbFile);
  if (mailDir) await rm(mailDir, { recursive: true, force: true });
});

const form = (data: Record<string, string>) => ({
  form: data,
  maxRedirects: 0,
  headers: { origin: base, accept: 'text/html' }
});

test('login form signs in, /app serves the authenticated account, sign-out revokes', async () => {
  const page = await ctx.get('/login');
  expect(page.status()).toBe(200);

  const rejected = await ctx.post(
    '/login',
    form({ email: 'e2e@example.test', password: 'wrong-password-1' })
  );
  expect(rejected.status()).toBe(401);

  const login = await ctx.post(
    '/login',
    form({ email: 'e2e@example.test', password: 'e2e-password-0000' })
  );
  expect(login.status()).toBe(303);
  expect(login.headers()['location']).toBe('/app');

  const session = await ctx.get('/api/auth/get-session');
  expect(session.status()).toBe(200);
  expect((await session.json()).user.email).toBe('e2e@example.test');

  const app = await ctx.get('/app');
  expect(app.status()).toBe(200);
  expect(await app.text()).toContain('E2E Learner');

  const out = await ctx.post('/app?/signOut', form({}));
  expect(out.status()).toBe(303);
  const after = await ctx.get('/api/auth/get-session');
  expect(await after.json()).toBeNull();
  const guarded = await ctx.get('/app', { maxRedirects: 0 });
  expect(guarded.status()).toBe(303);
  expect(guarded.headers()['location']).toBe('/login');
});

test('recovery mails a link that resets the password once', async () => {
  const recover = await ctx.post(
    '/recover',
    form({ email: 'e2e@example.test' })
  );
  expect(recover.status()).toBe(200);
  const ghost = await ctx.post(
    '/recover',
    form({ email: 'ghost@example.test' })
  );
  expect(ghost.status()).toBe(200);
  expect(await recover.text()).toEqual(await ghost.text());

  // The local capture adapter is the only mail channel: read it from disk.
  let files: string[] = [];
  for (let attempt = 0; attempt < 50 && files.length === 0; attempt += 1) {
    files = (await readdir(mailDir)).filter((name) => name.endsWith('.json'));
    if (!files.length) await setTimeout(100);
  }
  expect(files).toHaveLength(1);
  const mail = JSON.parse(await readFile(join(mailDir, files[0]), 'utf8')) as {
    to: string;
    text: string;
  };
  expect(mail.to).toBe('e2e@example.test');
  const link = /https?:\/\/\S+/u.exec(mail.text)?.[0] ?? '';
  expect(link).toContain(`${base}/api/auth/reset-password/`);

  const validate = await ctx.get(link, { maxRedirects: 0 });
  expect(validate.status()).toBe(302);
  const location = validate.headers()['location'];
  // The token leaves the URL at the redirect: the page carries it through a
  // short-lived HttpOnly cookie so it cannot linger in history or referers.
  expect(location).toBe('/reset');
  const setCookie = validate
    .headersArray()
    .filter((header) => header.name.toLowerCase() === 'set-cookie')
    .map((header) => header.value)
    .join('; ');
  expect(setCookie).toContain('langlo_reset_token=');
  expect(setCookie).toContain('HttpOnly');
  const token = new URL(link).pathname.split('/').pop() ?? '';
  expect(token.length).toBeGreaterThan(10);
  const page = await ctx.get('/reset');
  expect(page.status()).toBe(200);
  expect(await page.text()).toContain(`value="${token}"`);

  const reset = await ctx.post(
    '/reset',
    form({ token, password: 'e2e-rotated-0000', confirm: 'e2e-rotated-0000' })
  );
  expect(reset.status()).toBe(303);

  const replay = await ctx.post(
    '/reset',
    form({ token, password: 'e2e-replay-0000', confirm: 'e2e-replay-0000' })
  );
  expect(replay.status()).toBe(400);

  const relogin = await ctx.post(
    '/login',
    form({ email: 'e2e@example.test', password: 'e2e-rotated-0000' })
  );
  expect(relogin.status()).toBe(303);
});

test('reset form reports mismatched and out-of-bounds passwords distinctly', async () => {
  const response = await ctx.post(
    '/reset',
    form({
      token: 'synthetic-token',
      password: 'e2e-mismatch-0000',
      confirm: 'e2e-mismatch-9999'
    })
  );
  expect(response.status()).toBe(400);
  expect(await response.text()).toContain('Passwords do not match.');

  const longPassword = 'e2e-long-password-' + '9'.repeat(130);
  const tooLong = await ctx.post(
    '/reset',
    form({
      token: 'synthetic-token',
      password: longPassword,
      confirm: longPassword
    })
  );
  expect(tooLong.status()).toBe(400);
  expect(await tooLong.text()).toContain('12–128 characters');
});

test('public signup creates a session while private routes still deny anon users', async () => {
  const anon = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { 'x-forwarded-proto': 'http' }
  });
  try {
    expect((await anon.get('/signup')).status()).toBe(200);
    for (const path of ['/signup', '/api/auth/sign-up/email']) {
      const details = {
        name: '   ',
        email: 'blank-signup@example.test',
        password: 'blank-signup-password-1'
      };
      const invalid = await anon.post(
        path,
        path === '/signup'
          ? form(details)
          : { headers: { origin: base }, data: details }
      );
      expect(invalid.status()).toBe(400);
      expect(invalid.headers()['set-cookie']).toBeUndefined();
    }
    const blankDatabase = createClient({ url: `file://${dbFile}` });
    try {
      const users = await blankDatabase.execute(
        "SELECT id FROM users WHERE email = 'blank-signup@example.test'"
      );
      expect(users.rows).toHaveLength(0);
    } finally {
      blankDatabase.close();
    }
    const signup = await anon.post(
      '/signup',
      form({
        name: 'New Learner',
        email: 'new@example.test',
        password: 'new-learner-password-0000'
      })
    );
    expect(signup.status()).toBe(303);
    expect(signup.headers()['location']).toBe('/app');
    const session = await anon.get('/api/auth/get-session');
    expect(session.status()).toBe(200);
    expect((await session.json()).user.email).toBe('new@example.test');
    const signedInSignup = await anon.get('/signup', { maxRedirects: 0 });
    expect(signedInSignup.status()).toBe(303);
    expect(signedInSignup.headers()['location']).toBe('/app');
    const staleSignup = await anon.post(
      '/signup',
      form({
        name: 'Second Account',
        email: 'stale-signup@example.test',
        password: 'stale-signup-password'
      })
    );
    expect(staleSignup.status()).toBe(303);
    const apiSignup = await anon.post('/api/auth/sign-up/email', {
      headers: { origin: base },
      data: {
        name: 'Second Account',
        email: 'api-second@example.test',
        password: 'api-second-password-1'
      }
    });
    expect(apiSignup.status()).toBe(409);
    expect(apiSignup.headers()['set-cookie']).toBeUndefined();
    const database = createClient({ url: `file://${dbFile}` });
    try {
      const users = await database.execute(
        "SELECT id FROM users WHERE email IN ('stale-signup@example.test', 'api-second@example.test')"
      );
      expect(users.rows).toHaveLength(0);
    } finally {
      database.close();
    }
    const retainedSession = await anon.get('/api/auth/get-session');
    expect((await retainedSession.json()).user.email).toBe('new@example.test');

    const anonymous = await request.newContext({
      baseURL: base,
      extraHTTPHeaders: { 'x-forwarded-proto': 'http' }
    });
    try {
      const get = await anonymous.get('/app', { maxRedirects: 0 });
      expect(get.status()).toBe(303);
      const post = await anonymous.post('/app/cards', {
        data: {},
        maxRedirects: 0
      });
      expect(post.status()).toBe(401);
    } finally {
      await anonymous.dispose();
    }
  } finally {
    await anon.dispose();
  }
});

test('public sign-up endpoint enforces the configured rate limit', async () => {
  await resetRateLimits(dbFile);
  const anon = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { 'x-forwarded-proto': 'http' }
  });
  try {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      statuses.push(
        (
          await anon.post('/api/auth/sign-up/email', {
            data: {
              email: `signup-${attempt}@example.test`,
              password: 'signup-rate-limit-password',
              name: 'Rate Limited Learner'
            },
            headers: {
              // Each attempt represents an anonymous learner on the shared network.
              cookie: '',
              origin: base,
              'x-forwarded-for': `192.0.2.${attempt + 1}`,
              'x-langlo-client-address': `198.51.100.${attempt + 1}`
            }
          })
        ).status()
      );
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429, 429]);
  } finally {
    await anon.dispose();
  }
});

test('invalid SMTP config leaves public pages and registration available', async () => {
  await resetRateLimits(dbFile);
  const port = await reservePort();
  const alternateBase = `http://127.0.0.1:${port}`;
  const featureServer = spawn('node', ['build'], {
    cwd: process.cwd(),
    env: {
      ...provisionEnv(),
      APP_ORIGIN: alternateBase,
      HOST: '127.0.0.1',
      PORT: String(port),
      ORIGIN: alternateBase,
      MAIL_TRANSPORT: 'smtp',
      MAIL_FROM: 'Langlo <ops@langlo.app>',
      PROTON_SMTP_TOKEN: 'synthetic-smtp-token'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  featureServer.stdout.on('data', (chunk) => {
    logs += String(chunk);
  });
  featureServer.stderr.on('data', (chunk) => {
    logs += String(chunk);
  });
  const client = await request.newContext({
    baseURL: alternateBase,
    extraHTTPHeaders: { 'x-forwarded-proto': 'http' }
  });
  try {
    await waitForLive(alternateBase);
    expect((await client.get('/')).status()).toBe(200);
    expect((await client.get('/prototype')).status()).toBe(200);
    expect((await client.get('/signup')).status()).toBe(200);
    const signup = await client.post('/api/auth/sign-up/email', {
      data: {
        name: 'SMTP Independent Learner',
        email: 'smtp-independent@example.test',
        password: 'smtp-independent-password'
      },
      headers: { origin: alternateBase }
    });
    expect(signup.status()).toBe(200);
    const recoveryApi = await client.post('/api/auth/request-password-reset', {
      data: { email: 'smtp-independent@example.test' },
      headers: { origin: alternateBase }
    });
    expect(recoveryApi.status()).toBe(503);
    const responseBody = await recoveryApi.json();
    expect(responseBody.correlationId).toBe(
      recoveryApi.headers()['x-correlation-id']
    );
    expect(JSON.stringify(responseBody)).not.toMatch(
      /smtp-independent@example\.test|synthetic-smtp-token|MAIL_FROM/u
    );
    expect(logs).toContain('"variable":"MAIL_FROM"');
    expect(logs).not.toContain('synthetic-smtp-token');
    expect(logs).not.toContain('smtp-independent@example.test');
  } finally {
    await client.dispose();
    featureServer.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      if (featureServer.exitCode !== null || featureServer.signalCode !== null)
        resolve();
      else featureServer.once('exit', () => resolve());
    });
  }
});

test('sign-in endpoint enforces the configured rate limit over HTTP', async () => {
  await resetRateLimits(dbFile);
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 7; attempt += 1) {
    statuses.push(
      (
        await ctx.post('/api/auth/sign-in/email', {
          data: { email: 'e2e@example.test', password: 'e2e-rotated-0000' },
          maxRedirects: 0
        })
      ).status()
    );
  }
  expect(
    statuses.filter((status) => status === 429).length
  ).toBeGreaterThanOrEqual(2);
});

test('login form action applies the same rate limit as the endpoint', async () => {
  await resetRateLimits(dbFile);
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 7; attempt += 1) {
    statuses.push(
      (
        await ctx.post('/login', {
          form: { email: 'e2e@example.test', password: 'e2e-rotated-0000' },
          headers: {
            origin: base,
            'x-forwarded-for': `192.0.2.${attempt + 1}`,
            'x-langlo-client-address': `198.51.100.${attempt + 1}`
          },
          maxRedirects: 0
        })
      ).status()
    );
  }
  expect(
    statuses.filter((status) => status === 429).length
  ).toBeGreaterThanOrEqual(2);
});

test('direct proxy policy isolates rate limits and fails auth safely on missing identity', async () => {
  await resetRateLimits(dbFile);
  const port = await reservePort();
  const proxyBase = `http://127.0.0.1:${port}`;
  const proxyServer = spawn('node', ['build'], {
    env: {
      ...provisionEnv(),
      APP_ORIGIN: proxyBase,
      HOST: '127.0.0.1',
      PORT: String(port),
      ADDRESS_HEADER: 'x-forwarded-for',
      XFF_DEPTH: '1',
      PROTOCOL_HEADER: 'x-forwarded-proto'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  proxyServer.stdout.on('data', (chunk) => {
    logs += String(chunk);
  });
  proxyServer.stderr.on('data', (chunk) => {
    logs += String(chunk);
  });
  const client = await request.newContext({
    baseURL: proxyBase,
    extraHTTPHeaders: { 'x-forwarded-proto': 'http' }
  });
  try {
    await waitForLive(proxyBase);
    for (const path of [
      '/',
      '/prototype',
      '/health/live',
      '/signup',
      '/login'
    ]) {
      expect((await client.get(path)).status()).toBe(200);
    }
    const invalidHeaders: Record<string, string>[] = [
      {},
      { 'x-forwarded-for': 'synthetic-invalid-address' }
    ];
    for (const headers of invalidHeaders) {
      const blocked = await client.get('/api/auth/get-session', { headers });
      expect(blocked.status()).toBe(503);
      const body = await blocked.json();
      expect(body.correlationId).toBe(blocked.headers()['x-correlation-id']);
      expect(JSON.stringify(body)).not.toMatch(
        /synthetic-invalid-address|ADDRESS_HEADER|stack/u
      );
      for (const path of ['/signup', '/login', '/recover', '/reset']) {
        const formResponse = await client.post(path, {
          headers: { ...headers, origin: proxyBase },
          form: {
            name: 'Fixture',
            email: 'proxy-fixture@example.test',
            password: 'fixture-password-0000',
            confirm: 'fixture-password-0000',
            token: 'synthetic-reset-token'
          },
          maxRedirects: 0
        });
        expect(formResponse.status()).toBe(503);
      }
    }
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const response = await client.post('/api/auth/sign-up/email', {
        // Simulate the trusted last proxy appending the actual peer after forged input.
        headers: {
          cookie: '',
          origin: proxyBase,
          'x-forwarded-for': `192.0.2.${attempt + 1}, 198.51.100.10`,
          'x-langlo-client-address': `203.0.113.${attempt + 1}`
        },
        data: {
          name: 'Fixture',
          email: `proxy-${attempt}@example.test`,
          password: 'fixture-password-0000'
        }
      });
      expect(response.status()).toBe(attempt < 5 ? 200 : 429);
    }
    const distinct = await client.post('/api/auth/sign-up/email', {
      headers: {
        cookie: '',
        origin: proxyBase,
        'x-forwarded-for': '198.51.100.11'
      },
      data: {
        name: 'Fixture',
        email: 'proxy-distinct@example.test',
        password: 'fixture-password-0000'
      }
    });
    expect(distinct.status()).toBe(200);
    expect(logs).not.toMatch(
      /synthetic-invalid-address|fixture-password-0000|Address header was specified/u
    );
  } finally {
    await client.dispose();
    proxyServer.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      if (proxyServer.exitCode !== null || proxyServer.signalCode !== null)
        resolve();
      else proxyServer.once('exit', () => resolve());
    });
  }
});
