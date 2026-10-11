import { describe, expect, it } from 'vitest';
import {
  deriveMissedItems,
  deriveTotals,
  draftIdFor,
  mistakePreview,
  recordRunAnswer,
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

describe('deriveTotals', () => {
  it('counts every outcome across a mixed session', () => {
    const answers = [
      answer('a', 'correct'),
      answer('b', 'incorrect', 'es', 'est'),
      answer('c', 'correct'),
      answer('d', 'incorrect', 'x', 'y'),
      answer('e', 'uncertain')
    ];
    expect(deriveTotals(answers)).toEqual({
      correct: 2,
      incorrect: 2,
      uncertain: 1
    });
  });

  it('reports zero incorrect for a clean session', () => {
    const answers = [answer('a', 'correct'), answer('b', 'correct')];
    expect(deriveTotals(answers)).toEqual({
      correct: 2,
      incorrect: 0,
      uncertain: 0
    });
  });

  it('returns zero totals when no run happened', () => {
    expect(deriveTotals([])).toEqual({
      correct: 0,
      incorrect: 0,
      uncertain: 0
    });
  });
});

describe('recordRunAnswer', () => {
  it('appends to a run in progress', () => {
    const session = { answers: [answer('a', 'correct')] };
    recordRunAnswer(session, answer('b', 'incorrect'), false);
    expect(session.answers).toHaveLength(2);
  });

  it('keeps a completed run until a new run is answered', () => {
    const session = {
      answers: [answer('a', 'incorrect'), answer('b', 'incorrect')]
    };
    // Revisiting practice does not record anything, so nothing is cleared.
    expect(session.answers).toHaveLength(2);
    recordRunAnswer(session, answer('c', 'correct'), true);
    expect(session.answers).toEqual([answer('c', 'correct')]);
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
    expect(first).toBe('n-session-choose-the-correct-completion-elle-fatig-es');
    expect(draftIdFor(missed)).toBe(first);
    expect(
      draftIdFor({ prompt: 'Different prompt', yourAnswer: 'a', expected: 'b' })
    ).not.toBe(first);
  });

  it('distinguishes different wrong answers to the same prompt', () => {
    const prompt = 'Choose the correct completion: « Elle ___ fatiguée. »';
    const es = draftIdFor({ prompt, yourAnswer: 'es', expected: 'est' });
    const suis = draftIdFor({ prompt, yourAnswer: 'suis', expected: 'est' });
    expect(es).not.toBe(suis);
    expect(es).toBe(draftIdFor({ prompt, yourAnswer: 'es', expected: 'est' }));
  });
});
