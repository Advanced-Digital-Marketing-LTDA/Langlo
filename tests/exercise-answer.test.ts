import { describe, expect, it } from 'vitest';
import {
  accentsFor,
  ANSWER_LIMIT,
  checkAnswer
} from '../src/lib/components/exercises/answer';

describe('checkAnswer', () => {
  it('trims and composes accents', () => {
    expect(checkAnswer('typed-blank', '  été ')).toEqual({
      ok: true,
      answer: 'été'
    });
  });

  it.each(['', '   ', '\n\t'])('rejects empty input %j', (raw) => {
    expect(checkAnswer('translation', raw)).toMatchObject({
      ok: false,
      code: 'EMPTY'
    });
  });

  it('accepts the limit and rejects one character over', () => {
    expect(checkAnswer('translation', 'a'.repeat(ANSWER_LIMIT)).ok).toBe(true);
    expect(
      checkAnswer('translation', 'a'.repeat(ANSWER_LIMIT + 1))
    ).toMatchObject({ ok: false, code: 'TOO_LONG' });
  });

  it('counts a character outside the BMP once', () => {
    expect(checkAnswer('correction', '😀'.repeat(ANSWER_LIMIT)).ok).toBe(true);
  });

  it('rejects non-text and null bytes', () => {
    for (const raw of [null, 42, undefined, { a: 1 }, 'es\0'])
      expect(checkAnswer('typed-blank', raw)).toMatchObject({
        ok: false,
        code: 'INVALID'
      });
  });

  it('keeps a blank on one line but allows lines elsewhere', () => {
    expect(checkAnswer('typed-blank', 'a\nb')).toMatchObject({ ok: false });
    expect(checkAnswer('correction', 'a\nb')).toMatchObject({ ok: true });
  });

  it('accepts only an offered option for multiple choice', () => {
    const options = ['suis', 'es', 'est'];
    expect(checkAnswer('multiple-choice', 'es', options).ok).toBe(true);
    expect(checkAnswer('multiple-choice', 'sommes', options)).toMatchObject({
      ok: false,
      code: 'NOT_AN_OPTION'
    });
    expect(checkAnswer('multiple-choice', 'es')).toMatchObject({ ok: false });
  });
});

describe('accentsFor', () => {
  it('offers the letters a track needs and none for English', () => {
    expect(accentsFor('fr')).toContain('é');
    expect(accentsFor('de')).toContain('ß');
    expect(accentsFor('en')).toEqual([]);
    expect(accentsFor('constructor')).toEqual([]);
  });
});
