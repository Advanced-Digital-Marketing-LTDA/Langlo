import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { reserveLibraryAiCall } from '../src/lib/server/library-ai';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { disposeFlashcardFixtures, fixture } from './fixtures/flashcards';

let client: Client;
let close: (() => void) | undefined;

beforeEach(async () => {
  ({ client, close } = await openFixtureDatabase(await fixture()));
});

afterEach(async () => {
  close?.();
  close = undefined;
  await disposeFlashcardFixtures();
});

describe('Library AI call budget', () => {
  it('keeps daily limits per learner and across learners under concurrent calls', async () => {
    const now = Date.UTC(2026, 9, 24, 12);
    const day = '2026-10-24';
    await client.execute({
      sql: 'INSERT INTO library_ai_usage (day, owner_id, calls) VALUES (?, ?, ?)',
      args: [day, 'learner-a', 1]
    });

    const reservations = await Promise.all([
      reserveLibraryAiCall(client, 'learner-a', now, 10, 2),
      reserveLibraryAiCall(client, 'learner-b', now, 10, 2)
    ]);
    expect(reservations.filter(Boolean)).toHaveLength(1);
    expect(
      (
        await client.execute({
          sql: 'SELECT SUM(calls) AS calls FROM library_ai_usage WHERE day = ?',
          args: [day]
        })
      ).rows[0].calls
    ).toBe(2);
  });

  it('starts a fresh budget on the next UTC day', async () => {
    await client.execute({
      sql: 'INSERT INTO library_ai_usage (day, owner_id, calls) VALUES (?, ?, ?)',
      args: ['2026-10-23', 'learner-a', 10]
    });
    await expect(
      reserveLibraryAiCall(client, 'learner-a', Date.UTC(2026, 9, 24), 1, 1)
    ).resolves.toBe(true);
  });

  it('deletes owner counters when the account is deleted', async () => {
    await client.execute({
      sql: 'INSERT INTO library_ai_usage (day, owner_id, calls) VALUES (?, ?, ?)',
      args: ['2026-10-24', 'learner-a', 1]
    });
    await client.execute({
      sql: 'DELETE FROM users WHERE id = ?',
      args: ['learner-a']
    });
    expect(
      (await client.execute('SELECT * FROM library_ai_usage')).rows
    ).toEqual([]);
  });
});
