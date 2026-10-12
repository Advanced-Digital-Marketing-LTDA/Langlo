import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  createServer,
  request as proxyRequest,
  type IncomingMessage,
  type IncomingHttpHeaders,
  type Server,
  type ServerResponse
} from 'node:http';
import { mkdir, rm } from 'node:fs/promises';
import {
  e2eAuthPort,
  e2eAuthServerPort,
  e2eAuthOrigin,
  mailCaptureDirectory
} from './e2e-auth-mail.ts';

const secret = 'e2e-only-auth-secret-0000000000000000';
const appOrigin = process.env.APP_ORIGIN ?? e2eAuthOrigin;
const env = {
  ...process.env,
  APP_ENV: 'test',
  APP_ORIGIN: appOrigin,
  DATA_ENABLED: 'true',
  BETTER_AUTH_SECRET: secret,
  MAIL_TRANSPORT: 'capture',
  MAIL_CAPTURE_DIR: mailCaptureDirectory
};

function run(args: string[], input?: string): string {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env,
    input: input === undefined ? undefined : `${input}\n`,
    encoding: 'utf8'
  });
  if (result.status !== 0) throw new Error('Auth E2E fixture setup failed');
  return result.stdout.trim();
}

const init = JSON.parse(run(['tests/fixtures/cli.ts', 'init'])) as {
  fixtureRoot: string;
  databaseUrl: string;
};
const databaseUrl = init.databaseUrl;
const fixtureEnv = { ...env, DATABASE_URL: databaseUrl };
let fixtureDisposed = false;
let server: ChildProcess | undefined;
let proxy: Server | undefined;
let cleaning: Promise<void> | undefined;
const proxyOrigin = new URL(e2eAuthOrigin);

async function stopServer(): Promise<void> {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => {
    server?.once('exit', () => resolve());
  });
  if (server.exitCode !== null || server.signalCode !== null) return;
  server.kill('SIGTERM');
  if (server.exitCode === null && server.signalCode === null) await exited;
}

function forwardHeaders(incoming: IncomingMessage): IncomingHttpHeaders {
  // The browser sandbox reports an opaque Origin; restore the test app origin for its form actions.
  const headers = {
    ...incoming.headers,
    host: proxyOrigin.host,
    'x-forwarded-proto': 'http'
  };
  if (incoming.method === 'POST' && incoming.headers.origin === 'null')
    headers.origin = e2eAuthOrigin;
  return headers;
}

function forwardResponse(
  response: IncomingMessage,
  outgoing: ServerResponse
): void {
  outgoing.writeHead(response.statusCode ?? 502, response.headers);
  response.pipe(outgoing);
}

function forwardRequest(
  incoming: IncomingMessage,
  outgoing: ServerResponse
): void {
  const upstream = proxyRequest(
    {
      hostname: '127.0.0.1',
      port: Number(e2eAuthServerPort),
      path: incoming.url,
      method: incoming.method,
      headers: forwardHeaders(incoming)
    },
    (response) => forwardResponse(response, outgoing)
  );
  upstream.on('error', () => {
    outgoing.statusCode = 502;
    outgoing.end();
  });
  incoming.pipe(upstream);
}

function startProxy(): Promise<void> {
  proxy = createServer(forwardRequest);
  return new Promise<void>((resolve, reject) => {
    proxy?.once('error', reject);
    proxy?.listen(
      Number(e2eAuthPort),
      process.env.HOST ?? '127.0.0.1',
      resolve
    );
  });
}

async function stopProxy(): Promise<void> {
  if (!proxy?.listening) return;
  await new Promise<void>((resolve) => {
    proxy?.close(() => resolve());
  });
}

async function disposeFixture(): Promise<void> {
  if (fixtureDisposed) return;
  try {
    const result = spawnSync(
      process.execPath,
      [
        'tests/fixtures/cli.ts',
        'dispose',
        '--fixture-root',
        init.fixtureRoot,
        '--database-url',
        databaseUrl
      ],
      { cwd: process.cwd(), env: fixtureEnv, stdio: 'ignore' }
    );
    if (result.status !== 0) throw new Error('fixture cleanup failed');
    fixtureDisposed = true;
  } catch {
    await rm(init.fixtureRoot, { recursive: true, force: true });
    fixtureDisposed = true;
  }
}

function cleanup(): Promise<void> {
  cleaning ??= (async () => {
    await stopProxy();
    await stopServer();
    await disposeFixture();
    await rm(mailCaptureDirectory, { recursive: true, force: true });
  })();
  return cleaning;
}

try {
  await rm(mailCaptureDirectory, { recursive: true, force: true });
  await mkdir(mailCaptureDirectory, { recursive: true, mode: 0o700 });
  run([
    'tests/fixtures/cli.ts',
    'migrate',
    '--fixture-root',
    init.fixtureRoot,
    '--database-url',
    databaseUrl
  ]);
  run([
    'tests/fixtures/cli.ts',
    'seed',
    '--fixture-root',
    init.fixtureRoot,
    '--database-url',
    databaseUrl
  ]);
  const provision = spawnSync(
    process.execPath,
    [
      'scripts/accounts-provision.ts',
      '--app',
      '--email',
      'e2e@example.test',
      '--name',
      'E2E Learner'
    ],
    {
      cwd: process.cwd(),
      env: fixtureEnv,
      input: 'e2e-password-0000\n',
      encoding: 'utf8'
    }
  );
  if (provision.status !== 0)
    throw new Error('Auth E2E account provisioning failed');
  server = spawn(process.execPath, ['build'], {
    cwd: process.cwd(),
    env: {
      ...fixtureEnv,
      HOST: '127.0.0.1',
      PORT: e2eAuthServerPort,
      ORIGIN: appOrigin,
      PROTOCOL_HEADER: 'x-forwarded-proto'
    },
    stdio: 'inherit'
  });
  server.once('exit', () => void cleanup());
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      server?.kill(signal);
      void cleanup();
    });
  await startProxy();
} catch (error) {
  await cleanup();
  throw error;
}
