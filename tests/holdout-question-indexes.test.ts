import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client, InStatement } from '@libsql/client';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { importContent } from '../src/lib/server/content-import';
import { startAssessment } from '../src/lib/server/assessment';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession
} from './fixtures/flashcards';
import { approvedPackage } from './fixtures/content-package';

// Starting an assessment picks one holdout question per skill. Without these
// indexes it scanned every question and, for each holdout question, every
// answer the learner had ever given (280K rows per call in production).

let client: Client;
let close: (() => void) | undefined;

beforeEach(async () => {
  ({ client, close } = await openFixtureDatabase(await fixture()));
  const pkg = approvedPackage();
  pkg.versions[0].questions[1].holdout = true;
  pkg.versions[1].questions[0].holdout = true;
  await importContent(client, pkg);
  await client.batch(
    [
      "UPDATE skills SET retired_at = 1 WHERE id = 'fr-articles'",
      "INSERT INTO content_versions (id, skill_id, language, version, status) VALUES ('fr-a1-003@1', 'fr-a1-003', 'fr', 1, 'pilot-ready')",
      "INSERT INTO questions (id, content_version_id, skill_id, language, format, holdout, prompt, answer) VALUES ('fr-a1-003@1:q1', 'fr-a1-003@1', 'fr-a1-003', 'fr', 'typed-blank', 1, 'Synthetic prompt', 'es')"
    ],
    'write'
  );
});

afterEach(async () => {
  close?.();
  close = undefined;
  await disposeFlashcardFixtures();
});

/** The query plan of the statement the holdout-question pick actually sends. */
async function holdoutQuestionPlan() {
  let sent: InStatement | undefined;
  const watch = (statement: InStatement) => {
    const sql = typeof statement === 'string' ? statement : statement.sql;
    if (sql.includes('q.holdout = 1')) sent = statement;
  };
  const watching = new Proxy(client, {
    get(base, property) {
      const value = Reflect.get(base, property);
      if (property !== 'transaction')
        return typeof value === 'function' ? value.bind(base) : value;
      return async (...args: Parameters<Client['transaction']>) => {
        const tx = await base.transaction(...args);
        const execute = tx.execute.bind(tx);
        tx.execute = (statement: InStatement) => {
          watch(statement);
          return execute(statement);
        };
        return tx;
      };
    }
  });
  await startAssessment(watching, testSession('learner-a'), {
    language: 'fr',
    submissionKey: '00000000-0000-4000-8000-000000000001'
  });
  if (!sent || typeof sent === 'string')
    throw new Error('The holdout-question statement was not sent');
  const plan = await client.execute({
    sql: `EXPLAIN QUERY PLAN ${sent.sql}`,
    args: sent.args
  });
  return plan.rows.map((row) => String(row.detail));
}

describe('holdout-question lookup', () => {
  it('finds holdout questions of a language through an index', async () => {
    const plan = await holdoutQuestionPlan();
    expect(
      plan.some((step) =>
        step.startsWith('SEARCH q USING INDEX questions_language_holdout_idx')
      )
    ).toBe(true);
    expect(plan.filter((step) => step.startsWith('SCAN q'))).toEqual([]);
  });

  it("finds a learner's earlier answers on a skill through an index", async () => {
    const plan = await holdoutQuestionPlan();
    expect(
      plan.some((step) =>
        step.startsWith(
          'SEARCH a USING INDEX attempts_owner_skill_idx (owner_id=? AND skill_id=?)'
        )
      )
    ).toBe(true);
  });
});
