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
    await new Promise((resolve) => setTimeout(resolve, 100));
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
  run([
    'tests/fixtures/cli.ts',
    'dispose',
    '--fixture-root',
    fixtureRoot,
    '--database-url',
    `file://${dbFile}`
  ]);
  await rm(mailDir, { recursive: true, force: true });
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
    if (!files.length) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  expect(files).toHaveLength(1);
  const mail = JSON.parse(await readFile(join(mailDir, files[0]), 'utf8')) as {
    to: string;
    text: string;
  };
  expect(mail.to).toBe('e2e@example.test');
  const link = /https?:\/\/\S+/.exec(mail.text)?.[0] ?? '';
  expect(link).toContain(`${base}/api/auth/reset-password/`);

  const validate = await ctx.get(link, { maxRedirects: 0 });
  expect(validate.status()).toBe(302);
  const location = validate.headers()['location'];
  expect(location).toContain('/reset?token=');
  const token = new URL(location, base).searchParams.get('token') ?? '';
  expect(token.length).toBeGreaterThan(10);

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

test('no registration endpoint and unauthenticated /app requests are denied', async () => {
  const signup = await ctx.post('/api/auth/sign-up/email', {
    data: {
      email: 'new@example.test',
      password: 'whatever-password-1',
      name: 'x'
    },
    maxRedirects: 0,
    headers: { origin: base }
  });
  expect(signup.status()).toBe(400);

  const anon = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { 'x-forwarded-proto': 'http' }
  });
  try {
    const get = await anon.get('/app', { maxRedirects: 0 });
    expect(get.status()).toBe(303);
    const post = await anon.post('/app/cards', { data: {}, maxRedirects: 0 });
    expect(post.status()).toBe(401);
  } finally {
    await anon.dispose();
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
