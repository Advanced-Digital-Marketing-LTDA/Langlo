import { describe, expect, it } from 'vitest';
import { aggregateGrammarRatings } from '../src/lib/server/grammar-retention';

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
});
