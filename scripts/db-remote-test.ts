import { fileURLToPath } from 'node:url';
import type { Client } from '@libsql/client';
import {
  applyRemoteTestPlan,
  loadMigrations,
  parseRemoteTestTarget,
  readMigrationState,
  RemoteMigrationError,
  type RemoteTestTarget
} from '../src/lib/server/db/remote-migrate.ts';

const usage =
  'Usage: npm run db:remote-test -- status | plan | apply --confirm-host HOST --plan-id ID';

type Open = (target: RemoteTestTarget) => Promise<Client>;

/** Table names come from the target database; never let them inject lines or terminal escapes. */
const printable = (name: string) => name.replace(/[^\w.-]/g, '?');

/** Real connection; only reached after the target guard passed. */
const openRemote: Open = async (target) => {
  const { createClient } = await import('@libsql/client');
  return createClient({ url: target.url, authToken: target.authToken });
};

/** Accept exactly the documented flags; anything else is a usage error. */
function parseApplyFlags(
  args: string[]
): { confirmHost?: string; planId?: string } | null {
  const flags: { confirmHost?: string; planId?: string } = {};
  for (let i = 0; i < args.length; i += 2) {
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) return null;
    if (args[i] === '--confirm-host' && flags.confirmHost === undefined)
      flags.confirmHost = value;
    else if (args[i] === '--plan-id' && flags.planId === undefined)
      flags.planId = value;
    else return null;
  }
  return flags;
}

/**
 * Remote-test migration CLI. Prints only the target host, migration tags and
 * the plan id; never the URL, token or wrapped driver errors.
 */
export async function runRemoteTestCli(
  argv: string[],
  env: Record<string, string | undefined>,
  write: (line: string) => void,
  open: Open = openRemote
): Promise<number> {
  const [command, ...args] = argv;
  const flags = command === 'apply' ? parseApplyFlags(args) : null;
  if (
    !['status', 'plan', 'apply'].includes(command) ||
    (command !== 'apply' && args.length > 0) ||
    (command === 'apply' && flags === null)
  ) {
    write(usage);
    return 1;
  }
  let client: Client | undefined;
  try {
    const target = parseRemoteTestTarget(env);
    const migrations = loadMigrations();
    try {
      client = await open(target);
    } catch {
      write(
        'Remote-test migration failed. CONNECTION_FAILED: could not open the target'
      );
      return 1;
    }
    if (command === 'apply') {
      const result = await applyRemoteTestPlan(client, migrations, {
        host: target.host,
        confirmHost: flags?.confirmHost,
        planId: flags?.planId
      });
      write(`target host: ${target.host}`);
      write(
        result.applied.length === 0
          ? 'applied 0 migration(s); already up to date'
          : `applied ${result.applied.length} migration(s): ${result.applied.join(', ')}`
      );
      return 0;
    }
    const state = await readMigrationState(client, migrations);
    write(`target host: ${target.host}`);
    write(`ledger: ${state.ledgerPresent ? 'present' : 'absent'}`);
    write(
      `tables: ${state.userTables.length}${state.userTables.length ? ` (${state.userTables.map(printable).join(', ')})` : ''}`
    );
    write(
      `applied: ${state.applied.length}/${migrations.length}${state.applied.length ? ` (${state.applied.map((m) => m.tag).join(', ')})` : ''}`
    );
    write(
      `pending: ${state.pending.length}${state.pending.length ? ` (${state.pending.map((m) => m.tag).join(', ')})` : ''}`
    );
    if (command === 'plan') {
      for (const migration of state.pending)
        write(
          `  would apply ${migration.tag} (${migration.statements.length} statement(s), sha256 ${migration.hash.slice(0, 12)})`
        );
      write(`plan id: ${state.planId}`);
      write(
        state.pending.length === 0
          ? 'nothing to apply'
          : `to apply: npm run db:remote-test -- apply --confirm-host ${target.host} --plan-id ${state.planId}`
      );
    }
    return 0;
  } catch (error) {
    write(
      `Remote-test migration failed. ${error instanceof RemoteMigrationError ? error.message : 'UNEXPECTED: no changes were confirmed'}`
    );
    return 1;
  } finally {
    client?.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await runRemoteTestCli(
    process.argv.slice(2),
    process.env,
    (line) => console.log(line)
  );
}
