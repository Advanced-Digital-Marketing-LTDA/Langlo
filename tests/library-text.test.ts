import { describe, expect, it } from 'vitest';
import {
  containsTerm,
  highlightSavedTerms,
  splitSentences
} from '../src/lib/library-text';

describe('Library text', () => {
  it('splits sentences without dropping paragraph text', () => {
    expect(splitSentences('Bonjour, Marie.\nLa maison est grande!')).toEqual([
      'Bonjour, Marie.',
      'La maison est grande!'
    ]);
  });

  it('highlights saved words and phrases without matching inside other words', () => {
    expect(
      highlightSavedTerms('Une maison, une grande maison.', ['maison'])
    ).toEqual([
      { text: 'Une ', saved: false },
      { text: 'maison', saved: true },
      { text: ', une grande ', saved: false },
      { text: 'maison', saved: true },
      { text: '.', saved: false }
    ]);
    expect(highlightSavedTerms('Maintenant, elle part.', ['main'])).toEqual([
      { text: 'Maintenant, elle part.', saved: false }
    ]);
  });

  it('accepts contextual words and phrases only at word boundaries', () => {
    expect(containsTerm('The bank approved my loan.', 'bank')).toBe(true);
    expect(containsTerm('The banking app is open.', 'bank')).toBe(false);
    expect(containsTerm('The river bank is nearby.', 'river bank')).toBe(true);
  });
});
