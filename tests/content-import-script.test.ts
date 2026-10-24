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
import { importContent } from '../src/lib/server/content-import';
import { modulesPackage } from '../src/lib/server/content-modules';
import { migrateFixtureDatabase } from '../src/lib/server/db/migrate';
import type { FixtureTarget } from '../src/lib/server/db/fixture-target';
import {
  createDisposableFixture,
  disposeDisposableFixture
} from './fixtures/database';

// The import script against a real, disposable local database. Expected
// counts come from the raw module JSON, not from the code under test.

type RawLesson = {
  skill_id: string;
  title: string;
  explanation: string;
  examples: Record<string, string>[];
  references: string[];
  version: {
    id: string;
    version: number;
    questions: {
      id: string;
      format: string;
      prompt: string;
      answer: string;
      holdout?: boolean;
      change?: string;
      continues?: string;
    }[];
    translations?: {
      pt: {
        title: string;
        explanation: string;
        examples: Record<string, string>[];
        references: string[];
      };
    };
  };
};
type RawModule = { lessons: RawLesson[] };
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
// A revised lesson sits beside the version it revises, so lessons outnumber skills.
const skills = new Set(lessons.map((lesson) => lesson.skill_id)).size;
const questions = lessons.reduce((n, l) => n + l.version.questions.length, 0);
const latestMigrationTag = (
  JSON.parse(
    readFileSync(join(root, 'drizzle/meta/_journal.json'), 'utf8')
  ) as {
    entries: { tag: string }[];
  }
).entries.at(-1)?.tag;
if (!latestMigrationTag) throw new Error('migration journal has no entries');

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
      `${skills} skills, ${lessons.length} lessons, ${questions} questions`
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
    expect(await count('skills')).toBe(skills);
    expect(await count('content_versions')).toBe(lessons.length);
    expect(await count('questions')).toBe(questions);
    expect((await run(argv, env)).code).toBe(0);
    expect(await count('questions')).toBe(questions);
    expect(await count('curriculum_imports')).toBe(1);
  });

  it('reports the impact of a package on a database without writing', async () => {
    await migrateFixtureDatabase(target);
    const env = { DATABASE_URL: target.databaseUrl };
    const { code, out } = await run(
      ['--impact', '--confirm-host', 'local'],
      env
    );
    expect(code).toBe(0);
    expect(out).toContain('impact: no learner answers would stop counting');
    expect(out).toContain('impact report only: nothing written');
    expect(await count('skills')).toBe(0);
    expect(await count('curriculum_imports')).toBe(0);
  });

  it('refuses an impact report without a confirmed host or on an unmigrated database', async () => {
    expect((await run(['--impact'])).code).toBe(1);
    const { code, out } = await run(['--impact', '--confirm-host', 'local'], {
      DATABASE_URL: target.databaseUrl
    });
    expect(code).toBe(1);
    expect(out).toContain('migrations pending');
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
    expect(out).toContain(`migrations pending: ${latestMigrationTag}`);
    expect(await count('skills')).toBe(0);
  });

  it('refuses a remote URL that is not a bare Turso host', async () => {
    const { code, out } = await run(
      ['--apply', '--confirm-host', 'evil.test'],
      {
        DATABASE_URL: 'libsql://evil.test',
        TURSO_AUTH_TOKEN_2: 'secret-token'
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
        TURSO_AUTH_TOKEN_2: ' secret-token '
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

const rowsOf = async (client: ReturnType<typeof createClient>) =>
  (
    await client.execute(
      'SELECT id, content_version_id, prompt, answer, alternatives, lineage_key FROM questions ORDER BY id'
    )
  ).rows;

describe('revising already imported lessons', () => {
  it('adds each revision as a new version that continues the stored one', async () => {
    await migrateFixtureDatabase(target);
    const client = createClient({ url: target.databaseUrl });
    try {
      const pkg = modulesPackage(root);
      const revisions = pkg.versions.filter((version) =>
        version.questions.some((question) => question.change)
      );
      // 55 earlier revisions plus 27 reworded assessment prompts.
      expect(revisions).toHaveLength(82);
      await importContent(client, {
        ...pkg,
        curriculumVersion: '1.2.0',
        versions: pkg.versions.filter((version) => !revisions.includes(version))
      });
      const before = await rowsOf(client);
      // A learner already reviewing a revised skill keeps that schedule.
      await client.batch(
        [
          "INSERT INTO users (id, email, email_verified, created_at, updated_at) VALUES ('learner-a', 'a@example.test', 1, 0, 0)",
          `INSERT INTO grammar_retention_schedules (owner_id, language, skill_id, content_version_id, state_json, due_at, revision, reset_required, scheduler_version, parameters_json)
            VALUES ('learner-a', 'en', 'en-a1-005', 'en-a1-005@1', '{"due":"2026-11-02T09:00:00.000Z"}', 1793610000000, 2, 0, 'v1', '{}')`
        ],
        'write'
      );

      // The English revisions repeat their Portuguese translation, which is a
      // minor change, so a patch bump is refused and writes nothing.
      await expect(
        importContent(client, { ...pkg, curriculumVersion: '1.2.1' })
      ).rejects.toMatchObject({ code: 'VERSION_BUMP' });
      expect(await rowsOf(client)).toEqual(before);

      const result = await importContent(client, {
        ...pkg,
        curriculumVersion: '1.3.0'
      });
      expect(result.versions).toBe(revisions.length);
      expect(result.questions).toBe(revisions.length * 15);

      const after = await rowsOf(client);
      expect(
        after.filter((row) => before.some((b) => b.id === row.id))
      ).toEqual(before);
      const changes = await client.execute(
        "SELECT kind, count(*) AS n FROM content_changes WHERE curriculum_version = '1.3.0' GROUP BY kind ORDER BY kind"
      );
      expect(changes.rows.map((row) => [row.kind, Number(row.n)])).toEqual([
        // 25 earlier plus 19 English revisions of the 27 reworded prompts.
        ['lesson-translation-added', 44],
        ['question-same', revisions.length * 15],
        ['version-added', revisions.length]
      ]);
      // Wording continues the earlier question, so it keeps that question's key.
      const revised = after.find((row) => row.id === 'en-a1-005@2:h02');
      const original = after.find((row) => row.id === 'en-a1-005@1:h02');
      expect(revised?.prompt).toBe('He ___ a new bike. (buy) (simple past)');
      expect(original?.lineage_key).toBeNull();
      expect(revised?.lineage_key).toBe('h02');
      // Grammar retention transfers to the revision unchanged (migration 0031).
      expect(
        (
          await client.execute(
            "SELECT content_version_id, state_json, due_at, revision, reset_required FROM grammar_retention_schedules WHERE owner_id = 'learner-a'"
          )
        ).rows.map((row) => ({ ...row }))
      ).toEqual([
        {
          content_version_id: 'en-a1-005@2',
          state_json: '{"due":"2026-11-02T09:00:00.000Z"}',
          due_at: 1793610000000,
          revision: 3,
          reset_required: 0
        }
      ]);
    } finally {
      client.close();
    }
  });
});

describe('a published version edited in place', () => {
  it('refuses an in-place edit as a conflict, then imports the restored version', async () => {
    await migrateFixtureDatabase(target);
    const client = createClient({ url: target.databaseUrl });
    try {
      const pkg = modulesPackage(root);
      const revisions = pkg.versions.filter((version) =>
        version.questions.some((question) => question.change)
      );
      await importContent(client, {
        ...pkg,
        curriculumVersion: '1.2.0',
        versions: pkg.versions.filter(
          (version) => !revisions.some((revision) => revision.id === version.id)
        )
      });
      const before = await rowsOf(client);

      // The package as the review follow-up shipped it: the accepted answers
      // of pt-b1-024@1 changed in place instead of in a new version.
      const edited = structuredClone(pkg);
      const question = edited.versions
        .find((version) => version.id === 'pt-b1-024@1')
        ?.questions.find((item) => item.id === 'pt-b1-024@1:q09');
      if (!question) throw new Error('pt-b1-024@1:q09 is not in the package');
      expect(question.alternatives).toEqual([
        'Eu lembro do nome dela.',
        'Lembro-me do nome dela.'
      ]);
      question.alternatives = ['Lembro-me do nome dela.'];

      await expect(
        importContent(client, { ...edited, curriculumVersion: '1.3.0' })
      ).rejects.toMatchObject({
        code: 'CONTENT_CONFLICT',
        detail: 'version pt-b1-024@1'
      });
      expect(await rowsOf(client)).toEqual(before);
      // The package as it is imports cleanly over the same database.
      await importContent(client, { ...pkg, curriculumVersion: '1.3.0' });
    } finally {
      client.close();
    }
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

  it('passes every authored Portuguese translation through the import package', () => {
    const authored = lessons.filter(
      (lesson) => lesson.version.translations?.pt
    );
    // 45 first versions plus the 44 English revisions that repeat their translation.
    expect(authored).toHaveLength(89);

    const importedById = new Map(
      modulesPackage(root).versions.map((version) => [version.id, version])
    );
    expect(importedById.size).toBe(lessons.length);
    for (const source of lessons) {
      const imported = importedById.get(source.version.id);
      expect(imported, source.version.id).toBeDefined();
      expect(imported!.skillId, source.version.id).toBe(source.skill_id);
      expect(imported!.version, source.version.id).toBe(source.version.version);
      expect(imported!.lesson, source.version.id).toEqual({
        title: source.title,
        explanation: source.explanation,
        examples: source.examples,
        references: source.references
      });
      expect(
        imported!.questions.map(({ id, format, prompt, answer, holdout }) => [
          id,
          format,
          prompt,
          answer,
          holdout
        ])
      ).toEqual(
        source.version.questions.map(
          ({ id, format, prompt, answer, holdout }) => [
            id,
            format,
            prompt,
            answer,
            holdout
          ]
        )
      );
    }

    for (const source of authored) {
      const imported = importedById.get(source.version.id)!;
      const portuguese = source.version.translations!.pt;
      expect(imported.translations?.pt, source.version.id).toEqual(portuguese);
      expect(portuguese.title.trim(), source.version.id).not.toBe('');
      expect(portuguese.explanation.trim(), source.version.id).not.toBe('');
      expect(
        portuguese.examples.length,
        source.version.id
      ).toBeGreaterThanOrEqual(3);
      for (const example of portuguese.examples) {
        expect(example.en?.trim(), source.version.id).not.toBe('');
        expect(example.pt?.trim(), source.version.id).not.toBe('');
      }
      expect(portuguese.references, source.version.id).toEqual(
        source.references
      );
    }
    for (const source of lessons.filter(
      (lesson) => !lesson.version.translations
    ))
      expect(
        importedById.get(source.version.id)?.translations,
        source.version.id
      ).toBeUndefined();

    const questionWords = importedById.get('en-a1-007@1')?.translations?.pt;
    expect(
      questionWords?.examples.find(
        (example) => example.en === 'When is the class?'
      )?.pt
    ).toBe('Quando é a aula?');
  });

  it('passes the change declarations of revised questions through the import package', () => {
    const declared = lessons.flatMap((lesson) =>
      lesson.version.questions.filter((question) => question.change)
    );
    // 82 revised lessons of 15 questions each.
    expect(declared).toHaveLength(82 * 15);
    const imported = new Map(
      modulesPackage(root).versions.flatMap((version) =>
        version.questions.map((question) => [question.id, question] as const)
      )
    );
    for (const source of declared)
      expect(
        [imported.get(source.id)?.change, imported.get(source.id)?.continues],
        source.id
      ).toEqual([source.change, source.continues]);
  });

  function rejectsBadTranslation(
    mutate: (
      lesson: Record<string, unknown>,
      version: Record<string, unknown>
    ) => void
  ) {
    const module = JSON.parse(
      readFileSync(join(root, 'content/en-a1/module-02.json'), 'utf8')
    ) as { lessons: Record<string, unknown>[] };
    const lesson = module.lessons.find((item) => {
      const version = item.version as Record<string, unknown>;
      return version.translations !== undefined;
    });
    if (!lesson) throw new Error('module fixture has no translation');
    mutate(lesson, lesson.version as Record<string, unknown>);
    withModule(JSON.stringify(module), (dir) =>
      expect(() => modulesPackage(dir)).toThrow(/INVALID_MODULE/u)
    );
  }

  it('rejects a misspelled translation field instead of dropping it', () => {
    rejectsBadTranslation((_, version) => {
      version.translation = version.translations;
      delete version.translations;
    });
  });

  it('rejects a translation block placed at lesson level', () => {
    rejectsBadTranslation((lesson, version) => {
      lesson.translations = version.translations;
      delete version.translations;
    });
  });

  it('rejects an unsupported explanation language in a module', () => {
    rejectsBadTranslation((_, version) => {
      const translations = version.translations as Record<string, unknown>;
      translations['pt-BR'] = translations.pt;
    });
  });
});
