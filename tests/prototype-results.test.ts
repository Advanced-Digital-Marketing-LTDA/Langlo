import { describe, expect, it } from 'vitest';
import {
  deriveMissedItems,
  draftIdFor,
  mistakePreview,
  type SessionAnswer
} from '../src/lib/prototype/results';

const answer = (
  prompt: string,
  outcome: SessionAnswer['outcome'],
  yourAnswer = 'x',
  expected = 'y'
): SessionAnswer => ({ prompt, yourAnswer, expected, outcome });

describe('deriveMissedItems', () => {
  it('returns no mistakes for a clean session', () => {
    const answers = [
      answer('a', 'correct'),
      answer('b', 'correct'),
      answer('c', 'uncertain')
    ];
    expect(deriveMissedItems(answers, 0)).toEqual([]);
  });

  it('returns the single incorrect answer for a one-error session', () => {
    const answers = [
      answer('a', 'correct'),
      answer('missed prompt', 'incorrect', 'es', 'est'),
      answer('c', 'uncertain')
    ];
    expect(deriveMissedItems(answers, 1)).toEqual([
      { prompt: 'missed prompt', yourAnswer: 'es', expected: 'est' }
    ]);
  });

  it('returns every incorrect answer for a multi-error session', () => {
    const answers = [
      answer('one', 'incorrect', 'x1', 'y1'),
      answer('two', 'correct'),
      answer('three', 'incorrect', 'x3', 'y3')
    ];
    expect(deriveMissedItems(answers, 2)).toHaveLength(2);
  });

  it('falls back to the fixture item when no session run happened', () => {
    const fallback = deriveMissedItems([], 2);
    expect(fallback).toHaveLength(1);
    expect(fallback[0]?.expected).toBe('est');
    expect(deriveMissedItems([], 0)).toEqual([]);
  });
});

describe('mistakePreview', () => {
  it('extracts the quoted exercise from a completion prompt', () => {
    expect(
      mistakePreview({
        prompt: 'Choose the correct completion: « Elle ___ fatiguée. »',
        yourAnswer: 'es',
        expected: 'est'
      })
    ).toBe('« Elle ___ fatiguée » — est, not es');
  });

  it('uses the whole prompt when nothing is quoted', () => {
    expect(
      mistakePreview({
        prompt: 'Translate into French: “I am going to eat.”',
        yourAnswer: 'je mange',
        expected: 'Je vais manger'
      })
    ).toBe(
      'Translate into French: “I am going to eat.” — Je vais manger, not je mange'
    );
  });
});

describe('draftIdFor', () => {
  it('is stable for the same mistake and distinct across mistakes', () => {
    const missed = {
      prompt: 'Choose the correct completion: « Elle ___ fatiguée. »',
      yourAnswer: 'es',
      expected: 'est'
    };
    const first = draftIdFor(missed);
    expect(first).toBe('n-session-choose-the-correct-completion-elle-fatigu-e');
    expect(draftIdFor(missed)).toBe(first);
    expect(
      draftIdFor({ prompt: 'Different prompt', yourAnswer: 'a', expected: 'b' })
    ).not.toBe(first);
  });
});
