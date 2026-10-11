import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
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

interface ProvisionArgs {
  email?: string;
  name?: string;
  password?: string;
  fixtureRoot?: string;
  databaseUrl?: string;
}

type ArgKey = keyof ProvisionArgs;

// Static-property writes only: each option value lands on a named key, and
// argv is consumed by iteration so no computed member expression exists for
// object-injection sinks to flag.
const parseArgs = (argv: string[]) => {
  const args: ProvisionArgs = {};
  const flags = new Set<string>();
  let expecting: ArgKey | null = null;
  for (const arg of argv) {
    if (expecting !== null) {
      if (arg.startsWith('--')) fail();
      switch (expecting) {
        case 'email':
          args.email = arg;
          break;
        case 'name':
          args.name = arg;
          break;
        case 'password':
          args.password = arg;
          break;
        case 'fixtureRoot':
          args.fixtureRoot = arg;
          break;
        case 'databaseUrl':
          args.databaseUrl = arg;
          break;
      }
      expecting = null;
      continue;
    }
    switch (arg) {
      case '--app':
        flags.add('app');
        break;
      case '--email':
        expecting = 'email';
        break;
      case '--name':
        expecting = 'name';
        break;
      case '--password':
        expecting = 'password';
        break;
      case '--fixture-root':
        expecting = 'fixtureRoot';
        break;
      case '--database-url':
        expecting = 'databaseUrl';
        break;
      default:
        fail();
    }
  }
  if (expecting !== null) fail();
  return { args, flags };
};

const readPassword = async (): Promise<string> => {
  if (!input.isTTY) {
    let data = '';
    for await (const chunk of input) data += chunk;
    // Strip only the transport line ending; the login form does not trim,
    // so an operator's leading/trailing whitespace must survive intact.
    return data.replace(/(\r\n|\r|\n)$/, '');
  }
  output.write('Password: ');
  const sink = new Writable({
    write: (_chunk, _encoding, callback) => callback()
  });
  const rl = createInterface({ input, output: sink, terminal: true });
  try {
    return await rl.question('');
  } finally {
    rl.close();
    output.write('\n');
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
    if (!args.fixtureRoot || !args.databaseUrl) fail();
    const opened = await openFixtureDatabase({
      fixtureRoot: args.fixtureRoot,
      databaseUrl: args.databaseUrl
    });
    db = opened.db;
    config = {
      environment: 'test',
      origin: 'http://localhost:3000',
      dataEnabled: true,
      databaseUrl: args.databaseUrl,
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
