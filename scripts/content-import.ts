import { fileURLToPath } from 'node:url';
import type { Client } from '@libsql/client';
import {
  ContentImportError,
  importContent
} from '../src/lib/server/content-import.ts';
import { modulesPackage } from '../src/lib/server/content-modules.ts';
import {
  isBareRemoteUrl,
  loadMigrations,
  readMigrationState,
  RemoteMigrationError
} from '../src/lib/server/db/remote-migrate.ts';

const usage =
  'Usage: npm run content:import -- [--apply --confirm-host HOST]. Without --apply nothing is written. HOST is the DATABASE_URL host, or "local" for a file: URL.';

type Open = (url: string, authToken: string | undefined) => Promise<Client>;

const openClient: Open = async (url, authToken) => {
  const { createClient } = await import('@libsql/client');
  return createClient({ url, authToken });
};

type Target = { url: string; host: string; authToken?: string };

/** A local file: URL or a bare Turso libsql:// URL; anything else is refused before connecting. */
function parseTarget(env: Record<string, string | undefined>): Target {
  const raw = env.DATABASE_URL?.trim();
  if (!raw) throw new Error('DATABASE_URL is not set');
  if (raw.startsWith('file:')) return { url: raw, host: 'local' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }
  if (!isBareRemoteUrl(url))
    throw new Error(
      'DATABASE_URL must be a file: URL or a bare libsql://<name>.turso.io URL'
    );
  const authToken = env.TURSO_AUTH_TOKEN?.trim();
  if (!authToken) throw new Error('TURSO_AUTH_TOKEN is not set');
  const host = url.hostname.toLowerCase();
  return { url: `libsql://${host}`, host, authToken };
}

/**
 * Import every authored module into the shared content tables. Dry run by
 * default: builds and counts the package only. Never prints the URL or token.
 */
export async function runContentImport(
  argv: string[],
  env: Record<string, string | undefined>,
  write: (line: string) => void,
  open: Open = openClient,
  root = process.cwd()
): Promise<number> {
  const apply = argv[0] === '--apply';
  const confirmHost = argv[2];
  if (!(
    argv.length === 0 ||
    (apply && argv.length === 3 && argv[1] === '--confirm-host')
  )) {
    write(usage);
    return 1;
  }
  let client: Client | undefined;
  try {
    const pkg = modulesPackage(root);
    const questions = pkg.versions.reduce((n, v) => n + v.questions.length, 0);
    write(
      `package ${pkg.curriculumVersion}: ${pkg.skills.length} skills, ${pkg.versions.length} lessons, ${questions} questions`
    );
    if (!apply) {
      write('dry run: nothing written');
      return 0;
    }
    const target = parseTarget(env);
    if (confirmHost !== target.host)
      throw new Error('--confirm-host does not match the DATABASE_URL host');
    client = await open(target.url, target.authToken);
    await client.execute('SELECT 1');
    const state = await readMigrationState(
      client,
      loadMigrations(),
      target.host
    );
    if (!state.ledgerPresent || state.pending.length > 0)
      throw new Error(
        `migrations pending: ${state.pending.map((m) => m.tag).join(', ') || 'all'}; apply them first`
      );
    const result = await importContent(client, pkg);
    write(`target host: ${target.host}`);
    write(
      `imported ${result.skills} skills, ${result.prerequisites} prerequisites, ${result.versions} lessons, ${result.questions} questions, ${result.quarantined} quarantined`
    );
    return 0;
  } catch (error) {
    // Only our own fixed messages and error codes; never driver errors that may carry the URL.
    const known =
      error instanceof ContentImportError ||
      error instanceof RemoteMigrationError ||
      (error instanceof Error && error.constructor === Error);
    write(
      `Content import failed. ${known ? (error as Error).message : 'UNEXPECTED: nothing was confirmed written'}`
    );
    return 1;
  } finally {
    client?.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await runContentImport(
    process.argv.slice(2),
    process.env,
    (line) => console.log(line)
  );
}
