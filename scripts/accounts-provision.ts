import { createInterface } from 'node:readline/promises';
import { stdin as input, stderr as output } from 'node:process';
import { parseRuntimeConfig } from '../src/lib/server/config.ts';
import { createAuth } from '../src/lib/server/auth.ts';
import { provisionAccount } from '../src/lib/server/accounts.ts';
import { openFixtureDatabase } from '../src/lib/server/db/connection.ts';
import { openAppDatabase } from '../src/lib/server/db/app.ts';
import { CaptureMailer } from '../src/lib/server/mail.ts';
import type { RuntimeConfig } from '../src/lib/server/config.ts';

const fail = (): never => {
  console.error(
    'Provision rejected: check mode, target, email, name and password length'
  );
  process.exit(1);
};

const parseArgs = (argv: string[]) => {
  const args: Record<string, string> = {};
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--app') {
      flags.add('app');
    } else if (
      arg?.startsWith('--') &&
      argv[i + 1] &&
      !argv[i + 1].startsWith('--')
    ) {
      args[arg.slice(2)] = argv[++i];
    } else {
      fail();
    }
  }
  return { args, flags };
};

const readPassword = async (): Promise<string> => {
  if (!input.isTTY) {
    let data = '';
    for await (const chunk of input) data += chunk;
    return data.trim();
  }
  const rl = createInterface({ input, output });
  try {
    return (await rl.question('Password: ')).trim();
  } finally {
    rl.close();
  }
};

const main = async () => {
  const { args, flags } = parseArgs(process.argv.slice(2));
  const appMode = flags.has('app');
  if (!args.email || !args.name || args.password !== undefined) fail();
  const email = args.email;
  const name = args.name;

  let config: RuntimeConfig;
  let db: Awaited<ReturnType<typeof openFixtureDatabase>>['db'];
  let close: () => void;
  if (appMode) {
    // Production-capable path: validated env only; a separate authorization
    // gate applies before real accounts may be created.
    config = parseRuntimeConfig(process.env);
    if (!config.dataEnabled || !config.auth) fail();
    const opened = await openAppDatabase(config);
    db = opened.db;
    close = opened.close;
  } else {
    if (!args['fixture-root'] || !args['database-url']) fail();
    const opened = await openFixtureDatabase({
      fixtureRoot: args['fixture-root'],
      databaseUrl: args['database-url']
    });
    db = opened.db;
    config = {
      environment: 'test',
      origin: 'http://localhost:3000',
      dataEnabled: true,
      databaseUrl: args['database-url'],
      revision: 'unknown',
      auth: {
        secret:
          process.env.BETTER_AUTH_SECRET ?? 'fixture-only-provisioning-secret',
        mail: { transport: 'capture', smtpHost: 'localhost', smtpPort: 587 }
      }
    };
    close = opened.close;
  }
  try {
    const password = await readPassword();
    const auth = createAuth(config, { db, mailer: new CaptureMailer() });
    const account = await provisionAccount(auth, { email, name, password });
    console.log(
      JSON.stringify({ userId: account.userId, email: account.email })
    );
  } catch {
    fail();
  } finally {
    close();
  }
};

await main();
