import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runContentImport } from '../scripts/content-import';
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

async function run(argv: string[], env: Record<string, string> = {}) {
  const lines: string[] = [];
  const code = await runContentImport(argv, env, (line) => lines.push(line));
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
});
