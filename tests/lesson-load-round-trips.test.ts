import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client, InStatement, Transaction } from '@libsql/client';
import type { RuntimeConfig } from '../src/lib/server/config';
import type { FixtureTarget } from '../src/lib/server/db/fixture-target';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { importContent } from '../src/lib/server/content-import';
import { recordAnswer } from '../src/lib/server/lesson-practice';
import { load } from '../src/routes/app/learn/[language]/lesson/[skill]/+page.server';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession
} from './fixtures/flashcards';
import { approvedPackage } from './fixtures/content-package';

// The lesson page is reloaded after every answer and each database call costs
// a network round trip in production, so the number of calls and whether they
// overlap are part of the page's behavior.

// Measured: 4 reads, begin, 11 statements and commit. Raising it needs a reason.
const ANSWER_BUDGET = 15;

const held = vi.hoisted(() => ({ client: undefined as Client | undefined }));

vi.mock('../src/lib/server/db/app', () => ({
  openAppDatabase: async () => ({
    client: held.client,
    close: () => undefined
  })
}));

let target: FixtureTarget;
let close: (() => void) | undefined;
let raw: Client;

type Counted = { sqls: string[]; peak: number };

type Track = <T>(sql: string, run: () => Promise<T>) => Promise<T>;

/** Every call is held for a tick so calls issued together are seen as in flight together. */
function tracker(counted: Counted): Track {
  let inFlight = 0;
  return async (sql, run) => {
    counted.sqls.push(sql);
    inFlight += 1;
    counted.peak = Math.max(counted.peak, inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return await run();
    } finally {
      inFlight -= 1;
    }
  };
}

const sqlOf = (statement: InStatement) =>
  typeof statement === 'string' ? statement : statement.sql;

type Override<T> = (base: T) => unknown;

/** The object itself, except for the methods that are replaced. */
function overriding<T extends object>(
  target: T,
  replaced: Record<string, Override<T>>
): T {
  return new Proxy(target, {
    get(base, property) {
      const replacement =
        typeof property === 'string' ? replaced[property] : undefined;
      if (replacement) return replacement(base);
      const value = Reflect.get(base, property);
      return typeof value === 'function' ? value.bind(base) : value;
    }
  });
}

const statementCalls = <T extends Client | Transaction>(track: Track) => ({
  execute: (base: T) => (statement: InStatement) =>
    track(sqlOf(statement), () => base.execute(statement)),
  batch: (base: T) => (statements: InStatement[]) =>
    track('batch', () => base.batch(statements))
});

function counting(client: Client, counted: Counted): Client {
  const track = tracker(counted);
  const inTransaction = (tx: Transaction) =>
    overriding(tx, {
      ...statementCalls<Transaction>(track),
      commit: (base) => () => track('commit', () => base.commit())
    });
  return overriding(client, {
    ...statementCalls<Client>(track),
    transaction: (base) => async (mode: 'write' | 'read') => {
      counted.sqls.push('begin');
      return inTransaction(await base.transaction(mode));
    }
  });
}

beforeEach(async () => {
  target = await fixture();
  ({ client: raw, close } = await openFixtureDatabase(target));
  const pkg = approvedPackage();
  Object.assign(pkg.versions[0], {
    lesson: {
      title: 'Être',
      explanation: 'Use être.',
      examples: [],
      references: []
    }
  });
  await importContent(raw, pkg);
});

afterEach(async () => {
  close?.();
  close = undefined;
  await disposeFlashcardFixtures();
});

function pageEvent(session: string) {
  return {
    params: { language: 'fr', skill: 'fr-a1-001' },
    url: new URL(
      `http://127.0.0.1/app/learn/fr/lesson/fr-a1-001?session=${session}`
    ),
    locals: {
      config: {
        dataEnabled: true,
        databaseUrl: target.databaseUrl
      } as RuntimeConfig,
      user: { id: 'learner-a', email: 'a@x', name: 'a' },
      session: {
        id: 's-a',
        userId: 'learner-a',
        expiresAt: new Date(Date.now() + 1e6)
      }
    }
  } as never;
}

async function loadCounted(session = 'study-a') {
  const counted: Counted = { sqls: [], peak: 0 };
  held.client = counting(raw, counted);
  const data = (await load(pageEvent(session))) as Record<string, unknown>;
  return { data, counted };
}

const feedbackReads = (sqls: string[]) =>
  sqls.filter((sql) => sql.includes('AS expected_answer')).length;

describe('lesson page load round trips', () => {
  it('reads the feedback on the last answer once for the whole page', async () => {
    const form = new FormData();
    for (const [name, value] of Object.entries({
      studySessionId: 'study-a',
      submissionKey: 'k1',
      questionId: 'fr-a1-001@1:q1',
      answer: 'suis'
    }))
      form.set(name, value);
    await recordAnswer(raw, testSession('learner-a'), form, 'fr-a1-001');

    const { data, counted } = await loadCounted();

    expect(data).toMatchObject({
      unavailable: false,
      feedback: { outcome: 'correct', answer: 'suis' },
      exercise: { question: { id: 'fr-a1-001@1:q2' } }
    });
    expect(feedbackReads(counted.sqls)).toBe(1);
    expect(counted.sqls.length).toBeLessThanOrEqual(12);
  });

  it('saves an answer in few round trips', async () => {
    const counted: Counted = { sqls: [], peak: 0 };
    const form = new FormData();
    for (const [name, value] of Object.entries({
      studySessionId: 'study-a',
      submissionKey: 'k1',
      questionId: 'fr-a1-001@1:q1',
      answer: 'suis'
    }))
      form.set(name, value);

    const result = await recordAnswer(
      counting(raw, counted),
      testSession('learner-a'),
      form,
      'fr-a1-001'
    );

    expect(result).toMatchObject({ recorded: true, duplicate: false });
    const stored = await raw.execute(
      `SELECT COUNT(*) AS attempts, COUNT(e.id) AS evaluations FROM attempts a
        LEFT JOIN evaluations e ON e.attempt_id = a.id WHERE a.submission_key = 'k1'`
    );
    expect(stored.rows[0]).toMatchObject({ attempts: 1, evaluations: 1 });
    expect(counted.sqls.length).toBeLessThanOrEqual(ANSWER_BUDGET);
    // Only an assessment can complete from an answer; a practice answer sends
    // neither the count nor the completing update.
    expect(
      counted.sqls.some((sql) => sql.startsWith('UPDATE study_sessions'))
    ).toBe(false);
  });

  it('overlaps the lesson reads with the practice reads', async () => {
    const { counted } = await loadCounted();
    expect(counted.peak).toBeGreaterThanOrEqual(2);
  });

  it('keeps reading nothing about practice without a session', async () => {
    const { data, counted } = await loadCounted('');
    expect(data).toMatchObject({ exercise: null, feedback: null });
    expect(feedbackReads(counted.sqls)).toBe(0);
  });
});
