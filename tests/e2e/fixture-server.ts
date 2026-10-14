import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

// Shared setup for e2e specs that start their own built server against a
// disposable local fixture database.

/** Find a free loopback port by opening and closing a TCP probe. */
export async function reservePort(): Promise<number> {
  const probe = createServer();
  return new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() =>
        resolve(typeof address === 'object' && address ? address.port : 0)
      );
    });
  });
}

/** Wait up to ten seconds for the synthetic server's liveness endpoint. */
export async function waitForLive(
  origin: string,
  deadline = Date.now() + 10000
): Promise<void> {
  try {
    const response = await fetch(`${origin}/health/live`, {
      signal: AbortSignal.timeout(500)
    });
    if (response.ok) return;
  } catch {
    /* Startup is bounded by the deadline. */
  }
  if (Date.now() >= deadline) throw new Error('Fixture server did not start');
  await setTimeout(30);
  return waitForLive(origin, deadline);
}

/** Run a Node script from the repository root; throw with stderr on failure. */
export function runNode(
  args: string[],
  input?: string,
  env?: NodeJS.ProcessEnv
): string {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: env ?? process.env,
    input: input === undefined ? undefined : `${input}\n`,
    encoding: 'utf8'
  });
  if (result.status !== 0)
    throw new Error(`Command failed: node ${args.join(' ')}\n${result.stderr}`);
  return result.stdout.trim();
}

/** Create, migrate and seed a disposable fixture database. */
export function createFixtureDatabase() {
  const init = JSON.parse(runNode(['tests/fixtures/cli.ts', 'init'])) as {
    fixtureRoot: string;
    databaseUrl: string;
  };
  for (const step of ['migrate', 'seed'])
    runNode([
      'tests/fixtures/cli.ts',
      step,
      '--fixture-root',
      init.fixtureRoot,
      '--database-url',
      init.databaseUrl
    ]);
  return {
    fixtureRoot: init.fixtureRoot,
    dbFile: join(init.fixtureRoot, 'test.sqlite')
  };
}

/** Dispose a fixture; drop the root if setup failed before the database existed. */
export async function disposeFixtureDatabase(
  fixtureRoot: string,
  dbFile: string
) {
  if (!fixtureRoot) return;
  try {
    runNode([
      'tests/fixtures/cli.ts',
      'dispose',
      '--fixture-root',
      fixtureRoot,
      '--database-url',
      `file://${dbFile}`
    ]);
  } catch {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}
