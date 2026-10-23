import { afterEach, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import {
  openFixtureDatabase,
  type FixtureTarget
} from '../src/lib/server/db/connection';
import { migrateFixtureDatabase } from '../src/lib/server/db/migrate';
import {
  createDisposableFixture,
  disposeDisposableFixture
} from './fixtures/database';
import { prefixThrough } from './fixtures/migration-prefix';
import { seedStudy } from './fixtures/study';

// Migration 0031: grammar retention transfers to new content versions, and
// schedules the earlier reset triggers reset get their due date back.

const fixtures: FixtureTarget[] = [];
afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map((target) => disposeDisposableFixture(target))
  );
});

async function fixture() {
  const target = await createDisposableFixture();
  fixtures.push(target);
  return target;
}

describe('grammar retention transfer migration', () => {
  async function withResetSchedule(stateJson: string) {
    const target = await fixture();
    const folder = await prefixThrough('0030_portuguese_grammar_retention');
    try {
      await migrateFixtureDatabase(target, folder);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
    await seedStudy(target);
    const opened = await openFixtureDatabase(target);
    await opened.client.execute({
      sql: "INSERT INTO grammar_retention_schedules (owner_id, language, skill_id, content_version_id, state_json, due_at, revision, reset_required, scheduler_version, parameters_json) VALUES ('learner-a', 'fr', 'fr-articles', 'content-v1', ?, 0, 3, 1, 'fixture', '{}')",
      args: [stateJson]
    });
    return { ...opened, target };
  }

  it('restores schedules that an earlier version reset from their stored recall state', async () => {
    const state = JSON.stringify({ due: '2026-11-01T10:20:30.456Z', reps: 4 });
    const { client, close, target } = await withResetSchedule(state);
    try {
      await migrateFixtureDatabase(target);
      expect(
        (
          await client.execute(
            'SELECT content_version_id, state_json, due_at, revision, reset_required FROM grammar_retention_schedules'
          )
        ).rows
      ).toEqual([
        {
          content_version_id: 'content-v1',
          state_json: state,
          due_at: Date.parse('2026-11-01T10:20:30.456Z'),
          revision: 4,
          reset_required: 0
        }
      ]);
    } finally {
      close();
    }
  });

  it('upgrades a database where publishing reset a learner and gives the learner their schedule back', async () => {
    const state = JSON.stringify({ due: '2026-12-24T08:00:00.000Z', reps: 7 });
    const { client, close, target } = await withResetSchedule(state);
    try {
      await client.execute(
        'UPDATE grammar_retention_schedules SET reset_required = 0, due_at = 1'
      );
      await client.execute(
        "UPDATE content_versions SET status = 'pilot-ready' WHERE id = 'content-v2'"
      );
      expect(
        (
          await client.execute(
            'SELECT content_version_id, due_at, reset_required FROM grammar_retention_schedules'
          )
        ).rows
      ).toEqual([
        { content_version_id: 'content-v2', due_at: 0, reset_required: 1 }
      ]);
      await migrateFixtureDatabase(target);
      await migrateFixtureDatabase(target);
      expect(
        (
          await client.execute(
            'SELECT content_version_id, state_json, due_at, reset_required FROM grammar_retention_schedules'
          )
        ).rows
      ).toEqual([
        {
          content_version_id: 'content-v2',
          state_json: state,
          due_at: Date.parse('2026-12-24T08:00:00.000Z'),
          reset_required: 0
        }
      ]);
    } finally {
      close();
    }
  });

  it.each([
    ['no due date', JSON.stringify({ reps: 4 })],
    ['an unreadable due date', JSON.stringify({ due: 'soon', reps: 4 })]
  ])(
    'refuses to restore a reset schedule whose stored state has %s',
    async (_, state) => {
      const { client, close, target } = await withResetSchedule(state);
      try {
        await expect(migrateFixtureDatabase(target)).rejects.toThrow();
        expect(
          (
            await client.execute(
              'SELECT due_at, reset_required FROM grammar_retention_schedules'
            )
          ).rows
        ).toEqual([{ due_at: 0, reset_required: 1 }]);
      } finally {
        close();
      }
    }
  );
});
