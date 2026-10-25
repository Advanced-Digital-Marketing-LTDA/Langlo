import { expect, it } from 'vitest';
import {
  attachStudyTimer,
  createStudyTimer,
  idleLimitMs,
  type StudySegment
} from '../src/lib/study-timer';

function page() {
  const view = new EventTarget();
  const document = Object.assign(new EventTarget(), {
    visibilityState: 'visible' as DocumentVisibilityState
  });
  const sent: StudySegment[] = [];
  let time = 0;
  let next = 0;
  const timer = createStudyTimer(
    'grammar',
    (segment) => sent.push(segment),
    () => `segment-${(next += 1)}`
  );
  const detach = attachStudyTimer(timer, view, document, () => time);
  return {
    view,
    document,
    sent,
    detach,
    at(value: number) {
      time = value;
    }
  };
}

it('starts at mount and counts pointer, key and input events as actions', () => {
  const p = page();
  for (const [time, name] of [
    [40_000, 'pointerdown'],
    [80_000, 'keydown'],
    [120_000, 'input']
  ] as const) {
    p.at(time);
    p.view.dispatchEvent(new Event(name));
  }
  p.at(130_000);
  p.detach();

  expect(p.sent).toEqual([
    { id: 'segment-1', category: 'grammar', startedAt: 0, endedAt: 130_000 }
  ]);
});

it('stops when the tab is hidden, ignores actions while hidden, and restarts when visible', () => {
  const p = page();
  p.at(10_000);
  p.document.visibilityState = 'hidden';
  p.document.dispatchEvent(new Event('visibilitychange'));
  p.at(20_000);
  p.view.dispatchEvent(new Event('keydown'));
  p.at(500_000);
  p.document.visibilityState = 'visible';
  p.document.dispatchEvent(new Event('visibilitychange'));
  p.at(505_000);
  p.detach();

  expect(p.sent).toEqual([
    { id: 'segment-1', category: 'grammar', startedAt: 0, endedAt: 10_000 },
    {
      id: 'segment-2',
      category: 'grammar',
      startedAt: 500_000,
      endedAt: 505_000
    }
  ]);
});

it('ends the segment on pagehide and stops listening after cleanup', () => {
  const p = page();
  p.at(15_000);
  p.view.dispatchEvent(new Event('pagehide'));
  p.detach();
  p.at(16_000);
  p.view.dispatchEvent(new Event('keydown'));
  p.at(16_000 + idleLimitMs);
  p.view.dispatchEvent(new Event('pagehide'));

  expect(p.sent).toEqual([
    { id: 'segment-1', category: 'grammar', startedAt: 0, endedAt: 15_000 }
  ]);
});
