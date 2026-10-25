import { fileURLToPath } from 'node:url';
import type { Client } from '@libsql/client';
import {
  ContentImportError,
  type ContentPackage,
  importContent,
  validatePackage
} from '../src/lib/server/content-import.ts';
import {
  contentImpact,
  type ImpactLine
} from '../src/lib/server/content-impact.ts';
import { modulesPackage } from '../src/lib/server/content-modules.ts';
import {
  isBareRemoteUrl,
  loadMigrations,
  readMigrationState,
  RemoteMigrationError
} from '../src/lib/server/db/remote-migrate.ts';

const usage =
  'Usage: npm run content:import -- [--apply|--impact --confirm-host HOST]. Without --apply nothing is written; --impact only reads. HOST is the DATABASE_URL host, or "local" for a file: URL.';

/** This script's own fixed messages: the only errors whose text may be printed. */
class ScriptError extends Error {}

type Open = (url: string, authToken: string | undefined) => Promise<Client>;

const openClient: Open = async (url, authToken) => {
  const { createClient } = await import('@libsql/client');
  return createClient({ url, authToken });
};

type Target = { url: string; host: string; authToken?: string };

/** A local file: URL or a bare Turso libsql:// URL; anything else is refused before connecting. */
function parseTarget(env: Record<string, string | undefined>): Target {
  const raw = env.DATABASE_URL?.trim();
  if (!raw) throw new ScriptError('DATABASE_URL is not set');
  if (raw.startsWith('file:')) return { url: raw, host: 'local' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ScriptError('DATABASE_URL is not a valid URL');
  }
  if (!isBareRemoteUrl(url))
    throw new ScriptError(
      'DATABASE_URL must be a file: URL or a bare libsql://<name>.turso.io URL'
    );
  const authToken = env.TURSO_AUTH_TOKEN_2?.trim();
  if (!authToken) throw new ScriptError('TURSO_AUTH_TOKEN_2 is not set');
  const host = url.hostname.toLowerCase();
  return { url: `libsql://${host}`, host, authToken };
}

function argsAreValid(argv: string[]) {
  if (argv.length === 0) return true;
  const mode = argv[0];
  return (
    (mode === '--apply' || mode === '--impact') &&
    argv.length === 3 &&
    argv[1] === '--confirm-host'
  );
}

/** Open the confirmed target and refuse unless every migration is applied. */
async function openMigrated(
  open: Open,
  env: Record<string, string | undefined>,
  confirmHost: string | undefined
) {
  const target = parseTarget(env);
  if (confirmHost !== target.host)
    throw new ScriptError(
      '--confirm-host does not match the DATABASE_URL host'
    );
  const client = await open(target.url, target.authToken);
  try {
    await client.execute('SELECT 1');
    const state = await readMigrationState(
      client,
      loadMigrations(),
      target.host
    );
    if (!state.ledgerPresent || state.pending.length > 0)
      throw new ScriptError(
        `migrations pending: ${state.pending.map((m) => m.tag).join(', ') || 'all'}; apply them first`
      );
  } catch (error) {
    client.close();
    throw error;
  }
  return { client, host: target.host };
}

/** Only our own fixed messages and error codes; never driver errors that may carry the URL. */
function failureLine(error: unknown) {
  const known =
    error instanceof ScriptError ||
    error instanceof ContentImportError ||
    error instanceof RemoteMigrationError;
  return `Content import failed. ${known ? (error as Error).message : 'UNEXPECTED: nothing was confirmed written'}`;
}

export function writeImpactLine(
  line: ImpactLine,
  write: (line: string) => void
) {
  write(
    `impact: ${line.skillId}: ${line.reason}; ${line.answers} independent answer(s) by ${line.learners} learner(s) would stop counting`
  );
  for (const change of line.statusChanges ?? [])
    write(
      `impact: ${line.skillId}: ${change.learners} learner(s) would change from ${change.from} to ${change.to}`
    );
}

async function writeImpact(
  client: Client,
  pkg: ContentPackage,
  host: string,
  write: (line: string) => void
) {
  const lines = await contentImpact(client, pkg);
  write(`target host: ${host}`);
  if (lines.length === 0)
    write('impact: no learner answers would stop counting');
  for (const line of lines) writeImpactLine(line, write);
  write('impact report only: nothing written');
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
  const impact = argv[0] === '--impact';
  if (!argsAreValid(argv)) {
    write(usage);
    return 1;
  }
  let client: Client | undefined;
  try {
    const pkg = modulesPackage(root);
    // The importer's own checks, so a defective package fails the dry run too.
    validatePackage(pkg);
    const questions = pkg.versions.reduce((n, v) => n + v.questions.length, 0);
    write(
      `package ${pkg.curriculumVersion}: ${pkg.skills.length} skills, ${pkg.versions.length} lessons, ${questions} questions`
    );
    if (argv.length === 0) {
      write('dry run: nothing written');
      return 0;
    }
    const opened = await openMigrated(open, env, argv[2]);
    client = opened.client;
    if (impact) {
      await writeImpact(client, pkg, opened.host, write);
      return 0;
    }
    const result = await importContent(client, pkg);
    write(`target host: ${opened.host}`);
    write(
      `imported ${result.skills} skills, ${result.prerequisites} prerequisites, ${result.versions} lessons, ${result.questions} questions, ${result.quarantined} quarantined`
    );
    return 0;
  } catch (error) {
    write(failureLine(error));
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
