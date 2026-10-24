import { describe, expect, it } from 'vitest';
import {
  containsTerm,
  highlightSavedTerms,
  locateSelection,
  paginateText,
  sentenceContext,
  snapToWords,
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

  it('paginates at paragraph breaks and cuts oversized paragraphs at sentences', () => {
    expect(paginateText('One.\n\nTwo.\nThree.', 100)).toEqual([
      'One.\nTwo.\nThree.'
    ]);
    expect(paginateText('Alpha one.\nBravo two.\nCharlie three.', 22)).toEqual([
      'Alpha one.\nBravo two.',
      'Charlie three.'
    ]);
    expect(paginateText('Aaa. Bbb. Ccc.', 9)).toEqual(['Aaa. Bbb.', 'Ccc.']);
    expect(paginateText('abcdefgh', 3)).toEqual(['abc', 'def', 'gh']);
    expect(paginateText(' \n ', 10)).toEqual([]);
  });

  it('locates a selection across line breaks, preferring the nearest occurrence', () => {
    const page = 'The bank\nis open. The river bank is\nnearby.';
    expect(locateSelection(page, 'bank', 20)).toEqual({
      text: 'bank',
      start: 'The bank is open. The river '.length,
      end: 'The bank is open. The river bank'.length
    });
    expect(locateSelection(page, 'bank', 0)?.start).toBe(4);
    expect(locateSelection(page, 'is  open', 0)).toMatchObject({ start: 9 });
    expect(locateSelection(page, 'absent', 0)).toBeNull();
    expect(locateSelection(page, '  ', 0)).toBeNull();
  });

  it('returns the sentence around a selection with its neighbours', () => {
    const page = 'I applied on Monday. The bank approved my loan. It is open.';
    const start = page.indexOf('bank');
    expect(sentenceContext(page, start, start + 4, 'en')).toEqual({
      previousSentence: 'I applied on Monday.',
      sentence: 'The bank approved my loan.',
      nextSentence: 'It is open.'
    });
    expect(sentenceContext(page, 0, 1, 'en').previousSentence).toBe('');
    const across = sentenceContext(
      page,
      page.indexOf('Monday'),
      page.indexOf('bank') + 4,
      'en'
    );
    expect(across.sentence).toBe(
      'I applied on Monday. The bank approved my loan.'
    );
  });

  it('snaps a selection to whole words and trims edge punctuation', () => {
    const page = 'The bank, however, is open.';
    expect(snapToWords(page, 5, 8)).toEqual({ text: 'bank', start: 4, end: 8 });
    expect(snapToWords(page, 4, 9)).toEqual({ text: 'bank', start: 4, end: 8 });
    expect(snapToWords(page, 4, 17)).toEqual({
      text: 'bank, however',
      start: 4,
      end: 17
    });
    expect(snapToWords(page, 8, 10)).toBeNull();
  });
});
