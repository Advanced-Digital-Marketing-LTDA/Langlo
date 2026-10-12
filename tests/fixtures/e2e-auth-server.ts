import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { rm } from 'node:fs/promises';

const secret = 'e2e-only-auth-secret-0000000000000000';
const env = {
  ...process.env,
  APP_ENV: 'test',
  APP_ORIGIN: 'http://localhost:4173',
  DATA_ENABLED: 'true',
  BETTER_AUTH_SECRET: secret,
  MAIL_TRANSPORT: 'capture'
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
let cleaning: Promise<void> | undefined;

function cleanup(): Promise<void> {
  cleaning ??= (async () => {
    if (server && server.exitCode === null) {
      server.kill('SIGTERM');
      await new Promise<void>((resolve) =>
        server?.once('exit', () => resolve())
      );
    }
    if (!fixtureDisposed) {
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
      }
    }
  })();
  return cleaning;
}

try {
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
      PORT: '4173',
      ORIGIN: 'http://localhost:4173',
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
} catch (error) {
  await cleanup();
  throw error;
}
