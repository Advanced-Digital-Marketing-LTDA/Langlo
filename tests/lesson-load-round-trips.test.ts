import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client, InStatement } from '@libsql/client';
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

/** Every call is held for a tick so calls issued together are seen as in flight together. */
function counting(client: Client, counted: Counted): Client {
  let inFlight = 0;
  const track = async <T>(sql: string, run: () => Promise<T>) => {
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
  return new Proxy(client, {
    get(base, property) {
      const value = Reflect.get(base, property);
      if (property === 'execute')
        return (statement: InStatement) =>
          track(typeof statement === 'string' ? statement : statement.sql, () =>
            base.execute(statement)
          );
      if (property === 'batch')
        return (statements: InStatement[]) =>
          track('batch', () => base.batch(statements));
      return typeof value === 'function' ? value.bind(base) : value;
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
