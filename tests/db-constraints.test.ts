import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  openFixtureDatabase,
  type FixtureTarget
} from '../src/lib/server/db/connection';
import { migrateFixtureDatabase } from '../src/lib/server/db/migrate';
import {
  createDisposableFixture,
  disposeDisposableFixture
} from './fixtures/database';
import { seedStudy } from './fixtures/study';

let target: FixtureTarget;
beforeEach(async () => {
  target = await createDisposableFixture();
  await migrateFixtureDatabase(target);
  await seedStudy(target);
});
afterEach(async () => {
  await disposeDisposableFixture(target);
});

describe('actual SQLite ownership and version constraints', () => {
  it.each([2, -1, 0.5, 'true', null])(
    'rejects invalid persisted holdout %s',
    async (holdout) => {
      const { client, close } = await openFixtureDatabase(target);
      try {
        await expect(
          client.execute({
            sql: "UPDATE questions SET holdout = ? WHERE id = 'question-1'",
            args: [holdout]
          })
        ).rejects.toThrow();
        expect(
          (
            await client.execute(
              "SELECT holdout FROM questions WHERE id = 'question-1'"
            )
          ).rows
        ).toEqual([{ holdout: 0 }]);
      } finally {
        close();
      }
    }
  );

  it.each(['not-positive-integer', 1.5])(
    'rejects non-integral persisted content version %s',
    async (version) => {
      const { client, close } = await openFixtureDatabase(target);
      try {
        await expect(
          client.execute({
            sql: "UPDATE content_versions SET version=? WHERE id='content-v1'",
            args: [version]
          })
        ).rejects.toThrow(/integer/i);
        expect(
          (
            await client.execute(
              "SELECT version FROM content_versions WHERE id='content-v1'"
            )
          ).rows[0].version
        ).toBe(1);
      } finally {
        close();
      }
    }
  );
  it.each([
    "INSERT INTO study_sessions (id, owner_id, enrollment_id, language, mode) VALUES ('forged', 'learner-b', 'enrollment-a', 'fr', 'practice')",
    "INSERT INTO attempts (id, owner_id, study_session_id, question_id, content_version_id, skill_id, language, submission_key, evidence_kind, answer) VALUES ('forged', 'learner-b', 'study-a', 'question-1', 'content-v1', 'fr-articles', 'fr', 'forged', 'independent', 'un')",
    "INSERT INTO evaluations (id, owner_id, attempt_id, evaluator_version, rubric_version, outcome) VALUES ('forged', 'learner-b', 'attempt-a', 'prepared-forged', 'rubric-forged', 'correct')",
    "INSERT INTO attempts (id, owner_id, study_session_id, question_id, content_version_id, skill_id, language, submission_key, evidence_kind, answer) VALUES ('wrong-version', 'learner-a', 'study-a', 'question-1', 'content-v2', 'fr-articles', 'fr', 'wrong-version', 'independent', 'un')",
    "INSERT INTO skill_evidence (id, owner_id, attempt_id, evaluation_id, skill_id, language, scoring_version, contribution) VALUES ('forged', 'learner-b', 'attempt-a', 'evaluation-a', 'fr-articles', 'fr', 'mastery-v1', 1)"
  ])(
    'rejects a forged related-record owner or question version with no side effect: %s',
    async (statement) => {
      const { client, close } = await openFixtureDatabase(target);
      try {
        const before = (await client.execute('SELECT * FROM attempts')).rows;
        await expect(client.execute(statement)).rejects.toThrow(/FOREIGN KEY/i);
        expect((await client.execute('SELECT * FROM attempts')).rows).toEqual(
          before
        );
        expect((await client.execute('PRAGMA foreign_key_check')).rows).toEqual(
          []
        );
      } finally {
        close();
      }
    }
  );

  it('enforces supported enums, nonempty identity/version fields and positive content versions', async () => {
    const { client, close } = await openFixtureDatabase(target);
    try {
      for (const statement of [
        "UPDATE attempts SET evidence_kind='assumed' WHERE id='attempt-a'",
        "UPDATE content_versions SET version=0 WHERE id='content-v1'",
        "UPDATE questions SET format='essay' WHERE id='question-1'",
        "UPDATE evaluations SET outcome='probably' WHERE id='evaluation-a'",
        "UPDATE evaluations SET rubric_version='' WHERE id='evaluation-a'",
        "UPDATE enrollments SET language='es' WHERE id='enrollment-a'"
      ]) {
        await expect(client.execute(statement)).rejects.toThrow(
          /CHECK|FOREIGN KEY|positive safe integer|supported track/i
        );
      }
    } finally {
      close();
    }
  });

  it('stores assisted retries distinctly and deduplicates a repeated owner submission', async () => {
    const { client, close } = await openFixtureDatabase(target);
    try {
      await client.execute(
        "INSERT INTO attempts (id, owner_id, study_session_id, question_id, content_version_id, skill_id, language, submission_key, evidence_kind, answer) VALUES ('retry', 'learner-a', 'study-a', 'question-1', 'content-v1', 'fr-articles', 'fr', 'submit-retry', 'assisted', 'une')"
      );
      await expect(
        client.execute(
          "UPDATE attempts SET submission_key='submit-a' WHERE id='retry'"
        )
      ).rejects.toThrow(/UNIQUE/i);
      expect(
        (await client.execute('SELECT evidence_kind FROM attempts ORDER BY id'))
          .rows
      ).toEqual([
        { evidence_kind: 'independent' },
        { evidence_kind: 'assisted' }
      ]);
    } finally {
      close();
    }
  });

  it('owner deletion cascades its study history and leaves the other owner and shared versions intact', async () => {
    const { client, close } = await openFixtureDatabase(target);
    try {
      const beforeOther = (
        await client.execute(
          "SELECT * FROM study_sessions WHERE owner_id='learner-b'"
        )
      ).rows;
      const beforeContent = (
        await client.execute('SELECT * FROM content_versions ORDER BY id')
      ).rows;
      await client.execute("DELETE FROM users WHERE id='learner-a'");
      expect(
        (
          await client.execute(
            "SELECT * FROM study_sessions WHERE owner_id='learner-b'"
          )
        ).rows
      ).toEqual(beforeOther);
      expect(
        (await client.execute('SELECT * FROM content_versions ORDER BY id'))
          .rows
      ).toEqual(beforeContent);
      expect((await client.execute('SELECT * FROM attempts')).rows).toEqual([]);
      expect((await client.execute('SELECT * FROM evaluations')).rows).toEqual(
        []
      );
      expect(
        (
          await client.execute(
            "SELECT * FROM enrollments WHERE owner_id='learner-a'"
          )
        ).rows
      ).toEqual([]);
      expect((await client.execute('PRAGMA foreign_key_check')).rows).toEqual(
        []
      );
    } finally {
      close();
    }
  });

  it('rolls back all writes in a failing real libSQL transaction', async () => {
    const { client, close } = await openFixtureDatabase(target);
    try {
      await expect(
        client.batch(
          [
            "INSERT INTO users (id) VALUES ('transaction-temp')",
            "INSERT INTO enrollments (id, owner_id, language, starting_level, explanation_language) VALUES ('bad', 'missing-owner', 'fr', 'A1', 'en')"
          ],
          'write'
        )
      ).rejects.toThrow(/FOREIGN KEY/i);
      expect(
        (
          await client.execute(
            "SELECT * FROM users WHERE id='transaction-temp'"
          )
        ).rows
      ).toEqual([]);
    } finally {
      close();
    }
  });
});
