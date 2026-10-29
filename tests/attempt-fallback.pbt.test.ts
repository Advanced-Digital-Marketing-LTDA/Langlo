import fc from 'fast-check';
import { expect, it } from 'vitest';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { importContent } from '../src/lib/server/content-import';
import { recordAttempt } from '../src/lib/server/study';
import { evaluateFallback } from '../src/lib/server/evaluation/fallback';
import { typesafeUsage } from '../src/lib/server/evaluation/usage';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession
} from './fixtures/flashcards';
import { approvedPackage } from './fixtures/content-package';
import { propertyOptions } from './property-options';

type GeneratedOperation = {
  ownerB: boolean;
  alternate: boolean;
  correct: boolean;
};

type SequenceContext = {
  client: Awaited<ReturnType<typeof openFixtureDatabase>>['client'];
  text: string;
  state: {
    judgments: Map<string, string>;
    attemptIds: Set<string>;
    usage: ReturnType<typeof typesafeUsage>;
  };
};

async function runGeneratedSequence(
  text: string,
  operations: GeneratedOperation[]
) {
  const { client, close } = await openFixtureDatabase(await fixture());
  try {
    await importContent(client, approvedPackage());
    await client.execute(
      "UPDATE study_sessions SET mode = 'practice' WHERE id = 'study-b'"
    );
    const state = {
      judgments: new Map<string, string>(),
      attemptIds: new Set<string>(),
      usage: typesafeUsage(client, () => Date.UTC(2026, 9, 28))
    };
    for (const [index, operation] of operations.entries()) {
      await verifyGeneratedSubmission(
        { client, text, state },
        index,
        operation
      );
    }
  } finally {
    close();
    await disposeFlashcardFixtures();
  }
}

async function verifyGeneratedSubmission(
  context: SequenceContext,
  index: number,
  operation: GeneratedOperation
) {
  const { client, text, state } = context;
  const owner = operation.ownerB ? 'learner-b' : 'learner-a';
  const answer = `Cache ${operation.alternate ? 'B' : 'A'}: ${text}`;
  const identity = JSON.stringify([owner, answer]);
  const expected =
    state.judgments.get(identity) ??
    (operation.correct ? 'correct' : 'incorrect');
  const fallback = (input: Parameters<typeof evaluateFallback>[0]) =>
    evaluateFallback(
      input,
      async () => ({
        model: 'jev-latest',
        answers: {
          verdict: {
            type: 'noul',
            noul: operation.correct ? 0.9 : 0.1
          }
        },
        usage: { input_tokens: 1, output_tokens: 1 }
      }),
      state.usage
    );
  const input = {
    studySessionId: operation.ownerB ? 'study-b' : 'study-a',
    questionId: 'fr-a1-002@1:q1',
    submissionKey: `generated-${index}`,
    evidenceKind: 'assisted' as const,
    answer
  };
  const result = await recordAttempt(client, testSession(owner), input, {
    fallback
  });
  state.judgments.set(identity, expected);
  state.attemptIds.add(result.id);
  expect(state.attemptIds.size).toBe(index + 1);
  const evaluations = await client.execute({
    sql: "SELECT owner_id, outcome FROM evaluations WHERE attempt_id = ? AND evaluator_version = 'jev-2'",
    args: [result.id]
  });
  expect(evaluations.rows.map((row) => ({ ...row }))).toEqual([
    { owner_id: owner, outcome: expected }
  ]);
  expect(
    await recordAttempt(client, testSession(owner), input, { fallback })
  ).toEqual({ id: result.id, duplicate: true });
  const expectedCalls = state.judgments.size;
  const counters = await client.execute(
    "SELECT calls, input_tokens, output_tokens FROM ai_usage WHERE api = 'typesafe' AND month = '2026-10'"
  );
  expect(counters.rows.map((row) => ({ ...row }))).toEqual([
    {
      calls: expectedCalls,
      input_tokens: expectedCalls,
      output_tokens: expectedCalls
    }
  ]);
}

it('keeps grading reuse owner-scoped and preserves separate attempts across generated submission sequences', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.string({ unit: 'grapheme', maxLength: 32 }),
      fc.array(
        fc.record({
          ownerB: fc.boolean(),
          alternate: fc.boolean(),
          correct: fc.boolean()
        }),
        { minLength: 1, maxLength: 8 }
      ),
      (text, operations) => runGeneratedSequence(text, operations)
    ),
    {
      ...propertyOptions(),
      examples: [
        [
          '',
          [
            { ownerB: true, alternate: false, correct: false },
            { ownerB: false, alternate: false, correct: false }
          ]
        ],
        [
          '',
          [
            { ownerB: false, alternate: false, correct: false },
            { ownerB: false, alternate: true, correct: false }
          ]
        ]
      ]
    }
  );
}, 30000);
