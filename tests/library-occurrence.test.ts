import { describe, expect, it } from 'vitest';
import { selectionStartHint } from '../src/lib/library/occurrence';

describe('selectionStartHint', () => {
  it('picks the same occurrence when the DOM text lacks block separators', () => {
    const paragraphs = [
      ...Array.from({ length: 40 }, () => 'One two three.'),
      'The bank approved the loan.',
      'We sat on the river bank.'
    ];
    const page = paragraphs.join(' ');
    const before = paragraphs.join('').slice(0, -'bank.'.length);
    expect(selectionStartHint(page, before, 'bank')).toBe(
      page.lastIndexOf('bank')
    );
  });

  it('picks the first occurrence when none come before', () => {
    expect(selectionStartHint('bank and bank', '', 'bank')).toBe(0);
  });

  it('counts overlapping occurrences on both sides', () => {
    expect(selectionStartHint('aaa', 'aa', 'aa')).toBe(1);
  });

  it('uses the last occurrence when the page has fewer than expected', () => {
    expect(selectionStartHint('bank', 'bank bank', 'bank')).toBe(0);
  });

  it('returns 0 when the text is not on the page', () => {
    expect(selectionStartHint('river', 'bank', 'bank')).toBe(0);
  });
});
