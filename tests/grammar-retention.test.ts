import { describe, expect, it } from 'vitest';
import {
  aggregateGrammarRatings,
  type GrammarReviewCandidate
} from '../src/lib/server/grammar-retention';

describe('grammar retention session ratings', () => {
  it('keeps one lowest rating per skill for a completed session', () => {
    expect(
      aggregateGrammarRatings([
        {
          skillId: 'articles',
          outcome: 'correct',
          evidenceKind: 'independent',
          receivedHelp: false,
          notSure: false,
          available: true,
          rating: 'easy'
        },
        {
          skillId: 'articles',
          outcome: 'correct',
          evidenceKind: 'independent',
          receivedHelp: false,
          notSure: false,
          available: true,
          rating: 'hard'
        },
        {
          skillId: 'past-tense',
          outcome: 'correct',
          evidenceKind: 'independent',
          receivedHelp: false,
          notSure: false,
          available: true,
          rating: 'good'
        }
      ])
    ).toEqual(
      new Map([
        ['articles', 'hard'],
        ['past-tense', 'good']
      ])
    );
  });

  it('maps certain independent mistakes to Again and drops ineligible answers', () => {
    expect(
      aggregateGrammarRatings([
        {
          skillId: 'articles',
          outcome: 'incorrect',
          evidenceKind: 'independent',
          receivedHelp: false,
          notSure: false,
          available: true,
          rating: null
        },
        {
          skillId: 'assisted',
          outcome: 'correct',
          evidenceKind: 'independent',
          receivedHelp: true,
          notSure: false,
          available: true,
          rating: 'easy'
        },
        {
          skillId: 'unsure',
          outcome: 'uncertain',
          evidenceKind: 'independent',
          receivedHelp: false,
          notSure: true,
          available: true,
          rating: null
        },
        {
          skillId: 'uncertain',
          outcome: 'uncertain',
          evidenceKind: 'independent',
          receivedHelp: false,
          notSure: false,
          available: true,
          rating: 'easy'
        },
        {
          skillId: 'unrated',
          outcome: 'correct',
          evidenceKind: 'independent',
          receivedHelp: false,
          notSure: false,
          available: true,
          rating: null
        },
        {
          skillId: 'withdrawn',
          outcome: 'incorrect',
          evidenceKind: 'independent',
          receivedHelp: false,
          notSure: false,
          available: false,
          rating: null
        }
      ])
    ).toEqual(new Map([['articles', 'again']]));
  });

  it('allows an unassisted repeated item to schedule retention without mastery status', () => {
    expect(
      aggregateGrammarRatings([
        {
          skillId: 'articles',
          outcome: 'correct',
          evidenceKind: 'assisted',
          receivedHelp: false,
          notSure: false,
          available: true,
          rating: 'good'
        }
      ])
    ).toEqual(new Map([['articles', 'good']]));
  });
  it.each([
    ['helped correct', { receivedHelp: true }, null],
    ['helped incorrect', { receivedHelp: true, outcome: 'incorrect' }, null],
    ['unsure correct', { notSure: true }, null],
    ['unsure incorrect', { notSure: true, outcome: 'incorrect' }, null],
    ['unavailable correct', { available: false }, null],
    ['uncertain with rating', { outcome: 'uncertain' }, null],
    ['correct unrated', { rating: null }, null],
    ['incorrect unrated', { outcome: 'incorrect', rating: null }, 'again'],
    ['repeated unassisted', { evidenceKind: 'assisted' }, 'good']
  ] as [string, Partial<GrammarReviewCandidate>, string | null][])(
    'applies eligibility for %s independently',
    (_label, changes, expected) => {
      const candidate: GrammarReviewCandidate = {
        skillId: 'articles',
        outcome: 'correct',
        evidenceKind: 'independent',
        receivedHelp: false,
        notSure: false,
        available: true,
        rating: 'good',
        ...changes
      };
      expect(aggregateGrammarRatings([candidate])).toEqual(
        expected === null ? new Map() : new Map([['articles', expected]])
      );
    }
  );

  it.each([
    ['easy', 'hard', 'hard'],
    ['hard', 'easy', 'hard'],
    ['good', 'easy', 'good'],
    ['easy', 'good', 'good'],
    ['good', 'hard', 'hard']
  ] as const)(
    'keeps the lower rating for %s then %s',
    (first, second, expected) => {
      const candidate: GrammarReviewCandidate = {
        skillId: 'articles',
        outcome: 'correct',
        evidenceKind: 'independent',
        receivedHelp: false,
        notSure: false,
        available: true,
        rating: first
      };
      expect(
        aggregateGrammarRatings([candidate, { ...candidate, rating: second }])
      ).toEqual(new Map([['articles', expected]]));
    }
  );
});
