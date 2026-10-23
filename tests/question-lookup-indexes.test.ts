import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client, InStatement } from '@libsql/client';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { importContent } from '../src/lib/server/content-import';
import { nextQuestion } from '../src/lib/server/study';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession
} from './fixtures/flashcards';
import { approvedPackage } from './fixtures/content-package';

// The lesson page asks for a session's next question on every load and every
// answer. Without an index on the question's content version it read every
// question in the database each time (4,020 rows per call in production).

let client: Client;
let close: (() => void) | undefined;

beforeEach(async () => {
  ({ client, close } = await openFixtureDatabase(await fixture()));
  await importContent(client, approvedPackage());
});

afterEach(async () => {
  close?.();
  close = undefined;
  await disposeFlashcardFixtures();
});

/** The query plan of the statement the next-question read actually sends. */
async function nextQuestionPlan() {
  let sent: InStatement | undefined;
  const watching = new Proxy(client, {
    get(base, property) {
      const value = Reflect.get(base, property);
      if (property !== 'execute')
        return typeof value === 'function' ? value.bind(base) : value;
      return (statement: InStatement) => {
        const sql = typeof statement === 'string' ? statement : statement.sql;
        if (sql.includes('AS answered')) sent = statement;
        return base.execute(statement);
      };
    }
  });
  await nextQuestion(
    watching,
    testSession('learner-a'),
    'study-a',
    'fr-a1-001'
  );
  if (!sent || typeof sent === 'string')
    throw new Error('The next-question statement was not sent');
  const plan = await client.execute({
    sql: `EXPLAIN QUERY PLAN ${sent.sql}`,
    args: sent.args
  });
  return plan.rows.map((row) => String(row.detail));
}

describe('next-question lookup', () => {
  it('finds the questions of a version through an index', async () => {
    const plan = await nextQuestionPlan();
    expect(
      plan.some((step) =>
        step.startsWith('SEARCH q USING INDEX questions_content_version_idx')
      )
    ).toBe(true);
    expect(plan.filter((step) => step.startsWith('SCAN q'))).toEqual([]);
  });

  it("finds a session's answered questions through an index", async () => {
    const plan = await nextQuestionPlan();
    expect(
      plan.some((step) => step.includes('attempts_owner_session_question_idx'))
    ).toBe(true);
  });
});
