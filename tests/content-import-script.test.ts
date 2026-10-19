import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runContentImport } from '../scripts/content-import';
import { modulesPackage } from '../src/lib/server/content-modules';
import { migrateFixtureDatabase } from '../src/lib/server/db/migrate';
import type { FixtureTarget } from '../src/lib/server/db/fixture-target';
import {
  createDisposableFixture,
  disposeDisposableFixture
} from './fixtures/database';

// The import script against a real, disposable local database. Expected
// counts come from the raw module JSON, not from the code under test.

type RawModule = { lessons: { version: { questions: unknown[] } }[] };
const root = process.cwd();
const modules = readdirSync(join(root, 'content'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((dir) =>
    readdirSync(join(root, 'content', dir.name))
      .filter((name) => /^module-\d+\.json$/u.test(name))
      .map(
        (name) =>
          JSON.parse(
            readFileSync(join(root, 'content', dir.name, name), 'utf8')
          ) as RawModule
      )
  );
const lessons = modules.flatMap((module) => module.lessons);
const questions = lessons.reduce((n, l) => n + l.version.questions.length, 0);

let target: FixtureTarget;
beforeEach(async () => {
  target = await createDisposableFixture();
});
afterEach(async () => {
  await disposeDisposableFixture(target);
});

async function run(
  argv: string[],
  env: Record<string, string> = {},
  open?: Parameters<typeof runContentImport>[3]
) {
  const lines: string[] = [];
  const code = await runContentImport(
    argv,
    env,
    (line) => lines.push(line),
    open
  );
  return { code, out: lines.join('\n') };
}

async function count(table: string) {
  const client = createClient({ url: target.databaseUrl });
  try {
    return Number(
      (await client.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n
    );
  } finally {
    client.close();
  }
}

describe('content import script', () => {
  it('dry run reports the package and needs no database', async () => {
    const { code, out } = await run([]);
    expect(code).toBe(0);
    expect(out).toContain(
      `${lessons.length} skills, ${lessons.length} lessons, ${questions} questions`
    );
    expect(out).toContain('nothing written');
  });

  it('dry run fails on a package the importer would refuse', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'langlo-root-'));
    try {
      cpSync(join(root, 'content'), join(dir, 'content'), { recursive: true });
      mkdirSync(join(dir, 'docs'));
      cpSync(join(root, 'docs', 'evidence'), join(dir, 'docs', 'evidence'), {
        recursive: true
      });
      cpSync(
        join(root, 'docs', 'curriculum-coverage.csv'),
        join(dir, 'docs', 'curriculum-coverage.csv')
      );
      const path = join(dir, 'content', 'fr-a1', 'module-01.json');
      const module = JSON.parse(readFileSync(path, 'utf8')) as {
        lessons: { version: { questions: { answer: string }[] } }[];
      };
      // A multiple-choice answer that is not one of its options.
      module.lessons[0].version.questions[0].answer = 'not an option';
      writeFileSync(path, JSON.stringify(module));
      const lines: string[] = [];
      const code = await runContentImport(
        [],
        {},
        (l) => lines.push(l),
        undefined,
        dir
      );
      expect(code).toBe(1);
      expect(lines.join('\n')).toContain('INVALID_ALTERNATIVES');
      expect(lines.join('\n')).not.toContain('dry run: nothing written');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applies every module once and is a no-op the second time', async () => {
    await migrateFixtureDatabase(target);
    const env = { DATABASE_URL: target.databaseUrl };
    const argv = ['--apply', '--confirm-host', 'local'];
    expect((await run(argv, env)).code).toBe(0);
    expect(await count('skills')).toBe(lessons.length);
    expect(await count('content_versions')).toBe(lessons.length);
    expect(await count('questions')).toBe(questions);
    expect((await run(argv, env)).code).toBe(0);
    expect(await count('questions')).toBe(questions);
    expect(await count('curriculum_imports')).toBe(1);
  });

  it('writes nothing when the confirmed host does not match', async () => {
    await migrateFixtureDatabase(target);
    const { code, out } = await run(['--apply', '--confirm-host', 'other'], {
      DATABASE_URL: target.databaseUrl
    });
    expect(code).toBe(1);
    expect(out).toContain('--confirm-host does not match');
    expect(await count('skills')).toBe(0);
  });

  it('refuses a database whose migrations are not applied', async () => {
    const { code, out } = await run(['--apply', '--confirm-host', 'local'], {
      DATABASE_URL: target.databaseUrl
    });
    expect(code).toBe(1);
    expect(out).toContain('migrations pending');
  });

  it('refuses a partly migrated database', async () => {
    await migrateFixtureDatabase(target);
    const client = createClient({ url: target.databaseUrl });
    try {
      const removed = await client.execute(
        'DELETE FROM __drizzle_migrations WHERE rowid = (SELECT MAX(rowid) FROM __drizzle_migrations)'
      );
      expect(removed.rowsAffected).toBe(1);
    } finally {
      client.close();
    }
    const { code, out } = await run(['--apply', '--confirm-host', 'local'], {
      DATABASE_URL: target.databaseUrl
    });
    expect(code).toBe(1);
    expect(out).toContain('migrations pending: 0015');
    expect(await count('skills')).toBe(0);
  });

  it('refuses a remote URL that is not a bare Turso host', async () => {
    const { code, out } = await run(
      ['--apply', '--confirm-host', 'evil.test'],
      {
        DATABASE_URL: 'libsql://evil.test',
        TURSO_AUTH_TOKEN: 'secret-token'
      }
    );
    expect(code).toBe(1);
    expect(out).toContain('bare libsql://<name>.turso.io');
    expect(out).not.toContain('secret-token');
  });

  it('prints usage for unknown arguments', async () => {
    expect((await run(['--apply'])).code).toBe(1);
  });

  it('rejects a missing or malformed DATABASE_URL before connecting', async () => {
    const argv = ['--apply', '--confirm-host', 'local'];
    const missing = await run(argv, {});
    expect(missing.code).toBe(1);
    expect(missing.out).toContain('DATABASE_URL is not set');
    const malformed = await run(argv, { DATABASE_URL: 'not a url' });
    expect(malformed.code).toBe(1);
    expect(malformed.out).toContain('DATABASE_URL is not a valid URL');
  });

  it('accepts a bare Turso URL and connects to its normalized form', async () => {
    const opened: { url: string; token: string | undefined }[] = [];
    class Stop extends Error {}
    const { code, out } = await run(
      ['--apply', '--confirm-host', 'langlo-test.turso.io'],
      {
        DATABASE_URL: 'libsql://Langlo-Test.Turso.io/',
        TURSO_AUTH_TOKEN: ' secret-token '
      },
      async (url, token) => {
        opened.push({ url, token });
        throw new Stop('boom secret-token');
      }
    );
    expect(opened).toEqual([
      { url: 'libsql://langlo-test.turso.io', token: 'secret-token' }
    ]);
    // The connection failure is reported without its message or the token.
    expect(code).toBe(1);
    expect(out).toContain('UNEXPECTED');
    expect(out).not.toContain('secret-token');
  });
});

describe('module package', () => {
  function withModule(content: string, check: (dir: string) => void) {
    const dir = mkdtempSync(join(tmpdir(), 'langlo-modules-'));
    try {
      mkdirSync(join(dir, 'content', 'fr-a1'), { recursive: true });
      writeFileSync(join(dir, 'content', 'fr-a1', 'module-01.json'), content);
      check(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('names a module file that is not valid JSON', () => {
    withModule('{ "module_id": ', (dir) =>
      expect(() => modulesPackage(dir)).toThrow(
        /INVALID_MODULE.*module-01\.json/u
      )
    );
  });

  it('names a module file without lessons', () => {
    withModule('{"module_id":"x","review_status":"approved"}', (dir) =>
      expect(() => modulesPackage(dir)).toThrow(/INVALID_MODULE.*no lessons/u)
    );
  });

  it('refuses a directory with no module files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'langlo-modules-'));
    try {
      mkdirSync(join(dir, 'content'));
      expect(() => modulesPackage(dir)).toThrow(/NO_MODULES/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a module that is not approved', () => {
    const dir = mkdtempSync(join(tmpdir(), 'langlo-modules-'));
    try {
      mkdirSync(join(dir, 'content', 'fr-a1'), { recursive: true });
      writeFileSync(
        join(dir, 'content', 'fr-a1', 'module-01.json'),
        JSON.stringify({
          module_id: 'fr-a1-module-01',
          review_status: 'quarantined',
          lessons: []
        })
      );
      expect(() => modulesPackage(dir)).toThrow(
        /NOT_APPROVED.*fr-a1-module-01/u
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
