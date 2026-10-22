import { expect, it } from 'vitest';
import {
  masteryLabels,
  masteryStatuses,
  masterySymbols,
  summarizeTrack
} from '../src/lib/dashboard';
import type { TrackProgress } from '../src/lib/server/progress';

function skill(
  skillId: string,
  status: keyof typeof masteryLabels,
  available = true
) {
  return {
    skillId,
    level: 'A1',
    title: `Title ${skillId}`,
    contentVersionId: `${skillId}@1`,
    available,
    prerequisites: [],
    status,
    practisedSessions: 0,
    answers: 0,
    lastPractisedAt: null,
    correct: 0,
    incorrect: 0,
    sessions: 0,
    independentItems: 0,
    reason: `Reason ${skillId}`,
    policyVersion: 'grammar-2',
    retention: {
      state: 'not-assessed',
      dueAt: null,
      lastReviewedAt: null,
      retrievability: null,
      target: 0.9
    }
  } satisfies TrackProgress['skills'][number];
}
function track(
  statuses: [string, keyof typeof masteryLabels][],
  recommendedId: string | null,
  reason = 'Start here'
): TrackProgress {
  return {
    language: 'fr',
    level: 'A1',
    skills: statuses.map(([id, status]) => skill(id, status)),
    recommendation: recommendedId
      ? {
          skillId: recommendedId,
          reason,
          policyVersion: 'grammar-2',
          manualSkillIds: [recommendedId]
        }
      : null
  };
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

it('leaves unavailable skills out of the counts, total and list', () => {
  const summary = summarizeTrack({
    ...track([['a', 'secure']], null),
    skills: [skill('a', 'secure'), skill('b', 'weak', false)]
  });
  expect(summary.total).toBe(1);
  expect(summary.counts.weak).toBe(0);
  expect(summary.skills.map((item) => item.skillId)).toEqual(['a']);
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
  expect(summary.recommended).toMatchObject({
    skill: { skillId: 'b' },
    reason: 'Foundations first'
  });
});

it('has no recommendation when none is given or the skill is missing', () => {
  expect(summarizeTrack(track([['a', 'weak']], null)).recommended).toBeNull();
  expect(summarizeTrack(track([['a', 'weak']], 'gone')).recommended).toBeNull();
});

it('gives every status a distinct text label and symbol', () => {
  const statuses = Object.keys(masteryLabels) as (keyof typeof masteryLabels)[];
  expect(new Set(statuses.map((s) => masteryLabels[s])).size).toBe(4);
  expect(new Set(statuses.map((s) => masterySymbols[s])).size).toBe(4);
  expect([...masteryStatuses].sort()).toEqual([...statuses].sort());
});
