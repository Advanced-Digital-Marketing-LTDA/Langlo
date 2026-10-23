import { expect, it } from 'vitest';
import {
  createStudyTimer,
  idleLimitMs,
  type StudySegment
} from '../src/lib/study-timer';

function timer(category: 'flashcards' | 'grammar' = 'flashcards') {
  const sent: StudySegment[] = [];
  let next = 0;
  const value = createStudyTimer(
    category,
    (segment) => sent.push(segment),
    () => `segment-${(next += 1)}`
  );
  return { timer: value, sent };
}

it('counts gaps of up to a minute between actions on one page load', () => {
  const { timer: clock, sent } = timer('grammar');
  clock.activity(1_000);
  clock.activity(1_000 + idleLimitMs);
  clock.activity(1_000 + idleLimitMs + 30_000);
  clock.stop(1_000 + idleLimitMs + 40_000);

  expect(sent).toEqual([
    {
      id: 'segment-1',
      category: 'grammar',
      startedAt: 1_000,
      endedAt: 1_000 + idleLimitMs + 40_000
    }
  ]);
});

it('stops the timer after more than a minute without an action and skips that pause', () => {
  const { timer: clock, sent } = timer();
  clock.activity(0);
  clock.activity(20_000);
  clock.activity(20_000 + idleLimitMs + 1);
  clock.stop(20_000 + idleLimitMs + 11);

  expect(sent).toEqual([
    { id: 'segment-1', category: 'flashcards', startedAt: 0, endedAt: 20_000 },
    {
      id: 'segment-2',
      category: 'flashcards',
      startedAt: 20_000 + idleLimitMs + 1,
      endedAt: 20_000 + idleLimitMs + 11
    }
  ]);
});

it('ends the segment at the last action when the page is left after a long pause', () => {
  const { timer: clock, sent } = timer();
  clock.activity(0);
  clock.activity(5_000);
  clock.stop(5_000 + idleLimitMs + 1);

  expect(sent).toEqual([
    { id: 'segment-1', category: 'flashcards', startedAt: 0, endedAt: 5_000 }
  ]);
});

it('ends the running segment on stop, ignores a repeated stop, and starts a new segment on the next activity', () => {
  const { timer: clock, sent } = timer();
  clock.activity(0);
  clock.stop(10_000);
  clock.stop(20_000);
  clock.activity(500_000);
  clock.stop(510_000);

  expect(sent).toEqual([
    { id: 'segment-1', category: 'flashcards', startedAt: 0, endedAt: 10_000 },
    {
      id: 'segment-2',
      category: 'flashcards',
      startedAt: 500_000,
      endedAt: 510_000
    }
  ]);
});

it('sends nothing for a page that is left at the moment it loads', () => {
  const { timer: clock, sent } = timer();
  clock.activity(1_000);
  clock.stop(1_000);
  clock.stop(2_000);

  expect(sent).toEqual([]);
});
