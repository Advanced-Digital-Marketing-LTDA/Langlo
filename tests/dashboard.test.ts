import { expect, it } from 'vitest';
import {
  masteryLabels,
  masterySymbols,
  summarizeTrack
} from '../src/lib/dashboard';
import type { TrackProgress } from '../src/lib/server/progress';

function skill(skillId: string, status: keyof typeof masteryLabels) {
  return { skillId, title: `Title ${skillId}`, status } as never;
}
function track(
  statuses: [string, keyof typeof masteryLabels][],
  recommendedId: string | null,
  reason = 'Start here'
) {
  return {
    language: 'fr',
    level: 'A1',
    skills: statuses.map(([id, status]) => skill(id, status)),
    recommendation: recommendedId ? { skillId: recommendedId, reason } : null
  } as unknown as TrackProgress;
}

it('counts each mastery status and the total', () => {
  const summary = summarizeTrack(
    track(
      [
        ['a', 'secure'],
        ['b', 'secure'],
        ['c', 'weak'],
        ['d', 'unknown'],
        ['e', 'practising']
      ],
      null
    )
  );
  expect(summary.counts).toEqual({
    secure: 2,
    weak: 1,
    unknown: 1,
    practising: 1
  });
  expect(summary.total).toBe(5);
});

it('resolves the recommended skill and its reason', () => {
  const summary = summarizeTrack(
    track(
      [
        ['a', 'weak'],
        ['b', 'unknown']
      ],
      'b',
      'Foundations first'
    )
  );
  expect(summary.recommended).toMatchObject({ skillId: 'b' });
  expect(summary.reason).toBe('Foundations first');
});

it('has no recommendation when none is given or the skill is missing', () => {
  expect(summarizeTrack(track([['a', 'weak']], null))).toMatchObject({
    recommended: null,
    reason: null
  });
  expect(summarizeTrack(track([['a', 'weak']], 'gone'))).toMatchObject({
    recommended: null,
    reason: null
  });
});

it('gives every status a distinct text label and symbol', () => {
  const statuses = Object.keys(masteryLabels) as (keyof typeof masteryLabels)[];
  expect(new Set(statuses.map((s) => masteryLabels[s])).size).toBe(4);
  expect(new Set(statuses.map((s) => masterySymbols[s])).size).toBe(4);
});
