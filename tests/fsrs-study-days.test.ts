import { expect, it } from 'vitest';
import { studyDayStart } from '../src/lib/server/study-days';

it('starts the UTC study day at 04:00 and advances at that boundary', () => {
  expect(
    studyDayStart(new Date('2026-10-20T03:59:59Z'), 'UTC').toISOString()
  ).toBe('2026-10-19T04:00:00.000Z');
  expect(
    studyDayStart(new Date('2026-10-20T04:00:00Z'), 'UTC').toISOString()
  ).toBe('2026-10-20T04:00:00.000Z');
});

it('uses calendar study days across daylight-saving gaps and folds', () => {
  const beforeSpring = studyDayStart(
    new Date('2026-03-07T16:00:00Z'),
    'America/New_York'
  );
  const afterSpring = studyDayStart(
    new Date('2026-03-07T16:00:00Z'),
    'America/New_York',
    1
  );
  const beforeFall = studyDayStart(
    new Date('2026-10-31T16:00:00Z'),
    'America/New_York'
  );
  const afterFall = studyDayStart(
    new Date('2026-10-31T16:00:00Z'),
    'America/New_York',
    1
  );
  expect(afterSpring.getTime() - beforeSpring.getTime()).toBe(
    23 * 60 * 60 * 1000
  );
  expect(afterFall.getTime() - beforeFall.getTime()).toBe(25 * 60 * 60 * 1000);
});

it('resolves a skipped local calendar date to the first valid study-day start', () => {
  expect(
    studyDayStart(
      new Date('2011-12-29T20:00:00Z'),
      'Pacific/Apia',
      1
    ).toISOString()
  ).toBe('2011-12-30T14:00:00.000Z');
});

it('uses the earlier instant when a local study-day start repeats', () => {
  const first = studyDayStart(
    new Date('1969-09-29T12:00:00Z'),
    'Pacific/Kwajalein',
    1
  );
  expect(first.toISOString()).toBe('1969-09-29T17:00:00.000Z');
  const format = new Intl.DateTimeFormat('en', {
    timeZone: 'Pacific/Kwajalein',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23'
  });
  expect(format.format(first)).toBe(
    format.format(new Date(first.getTime() + 23 * 60 * 60 * 1000))
  );
});
