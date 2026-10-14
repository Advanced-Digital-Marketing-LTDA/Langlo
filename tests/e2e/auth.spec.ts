import {
  expect,
  test,
  type APIRequestContext,
  request
} from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { createClient } from '@libsql/client/sqlite3';

const run = (args: string[], input?: string, env?: NodeJS.ProcessEnv) => {
  const result = spawnSync('node', args, {
    cwd: process.cwd(),
    env: env ?? process.env,
    input: input === undefined ? undefined : `${input}\n`,
    encoding: 'utf8'
  });
  if (result.status !== 0)
    throw new Error(`Command failed: node ${args.join(' ')}\n${result.stderr}`);
  return result.stdout.trim();
};

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
  const { createServer } = await import('node:net');
  const port = await new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() =>
        resolve(typeof address === 'object' && address ? address.port : 0)
      );
    });
  });
  base = `http://127.0.0.1:${port}`;
  const init = JSON.parse(run(['tests/fixtures/cli.ts', 'init'])) as {
    fixtureRoot: string;
    databaseUrl: string;
  };
  fixtureRoot = init.fixtureRoot;
  run([
    'tests/fixtures/cli.ts',
    'migrate',
    '--fixture-root',
    fixtureRoot,
    '--database-url',
    init.databaseUrl
  ]);
  run([
    'tests/fixtures/cli.ts',
    'seed',
    '--fixture-root',
    fixtureRoot,
    '--database-url',
    init.databaseUrl
  ]);
  dbFile = join(fixtureRoot, 'test.sqlite');
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
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const probe = await fetch(`${base}/health/live`);
      if (probe.ok) break;
    } catch {
      /* not up yet */
    }
    await setTimeout(100);
    if (attempt === 99) throw new Error('auth e2e server did not start');
  }
  ctx = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { 'x-forwarded-proto': 'http' }
  });
});

test.afterAll(async () => {
  await ctx?.dispose();
  server?.kill();
  if (!fixtureRoot) return;
  try {
    run([
      'tests/fixtures/cli.ts',
      'dispose',
      '--fixture-root',
      fixtureRoot,
      '--database-url',
      `file://${dbFile}`
    ]);
  } catch {
    // Setup may have failed before the database file existed; drop the root.
    await rm(fixtureRoot, { recursive: true, force: true });
  }
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
  const client = createClient({ url: `file://${dbFile}` });
  try {
    await client.execute('DELETE FROM rate_limits');
  } finally {
    client.close();
  }
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
            headers: { origin: base }
          })
        ).status()
      );
    }
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(
      0
    );
  } finally {
    await anon.dispose();
  }
});

test('invalid SMTP config leaves public pages and registration available', async () => {
  const rateLimitClient = createClient({ url: `file://${dbFile}` });
  try {
    await rateLimitClient.execute('DELETE FROM rate_limits');
  } finally {
    rateLimitClient.close();
  }
  const { createServer } = await import('node:net');
  const probe = createServer();
  const port = await new Promise<number>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() =>
        resolve(typeof address === 'object' && address ? address.port : 0)
      );
    });
  });
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
    const deadline = Date.now() + 5000;
    let started = false;
    while (Date.now() < deadline) {
      try {
        const live = await client.get('/health/live', { timeout: 500 });
        if (live.status() === 200) {
          started = true;
          break;
        }
      } catch {
        /* Startup is bounded by the deadline. */
      }
      await setTimeout(30);
    }
    expect(started).toBe(true);
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
  const client = createClient({ url: `file://${dbFile}` });
  try {
    await client.execute('DELETE FROM rate_limits');
  } finally {
    client.close();
  }
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
  const client = createClient({ url: `file://${dbFile}` });
  try {
    await client.execute('DELETE FROM rate_limits');
  } finally {
    client.close();
  }
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 7; attempt += 1) {
    statuses.push(
      (
        await ctx.post('/login', {
          form: { email: 'e2e@example.test', password: 'e2e-rotated-0000' },
          headers: { origin: base },
          maxRedirects: 0
        })
      ).status()
    );
  }
  expect(
    statuses.filter((status) => status === 429).length
  ).toBeGreaterThanOrEqual(2);
});
