import { expect, it } from 'vitest';
import {
  fixtureException,
  readFixtureException
} from './e2e/fixture-error-diagnostics';

it('projects only fixed exception categories, codes and known function names', () => {
  const error = Object.assign(
    new Error('Authorization: Bearer private-token'),
    {
      name: 'LibsqlError',
      code: 'SQLITE_BUSY',
      stack: 'private-cookie at async recordAttemptWrite (/private/path:1:2)',
      cause: Object.assign(new Error('password=private-password'), {
        code: 'SQLITE_CONSTRAINT_TRIGGER'
      })
    }
  );
  expect(fixtureException(error)).toEqual([
    {
      kind: 'LibsqlError',
      code: 'SQLITE_BUSY',
      frames: ['recordAttemptWrite']
    },
    { kind: 'Error', code: 'SQLITE_CONSTRAINT_TRIGGER', frames: [] }
  ]);
  expect(JSON.stringify(fixtureException(error))).not.toMatch(
    /private|Authorization|Bearer|password/
  );
});

it('drops arbitrary names, codes, messages and bounds cyclic causes', () => {
  const error = {
    name: 'private-name',
    code: 'private-token',
    message: 'cookie=secret'
  };
  Object.assign(error, { cause: error });
  expect(fixtureException(error)).toEqual([
    { kind: 'Other', code: undefined, frames: [] },
    { kind: 'Other', code: undefined, frames: [] },
    { kind: 'Other', code: undefined, frames: [] }
  ]);
  expect(fixtureException('Bearer private-token')).toEqual([]);
});

it('revalidates piped output and ignores malformed or unrelated lines', () => {
  expect(
    readFixtureException('Authorization: Bearer private-token')
  ).toBeUndefined();
  expect(
    readFixtureException('FIXTURE_SERVER_EXCEPTION not-json')
  ).toBeUndefined();
  expect(
    readFixtureException(
      'FIXTURE_SERVER_EXCEPTION ' +
        JSON.stringify([
          {
            kind: 'private-password',
            code: 'private-token',
            frames: ['private-cookie', 'recordAttemptWrite']
          }
        ])
    )
  ).toEqual([
    { kind: 'Other', code: undefined, frames: ['recordAttemptWrite'] }
  ]);
});
