import { describe, expect, it } from 'vitest';
import {
  evaluatePrepared,
  PREPARED_EVALUATOR_VERSION,
  typedMatchKey
} from '../src/lib/server/evaluation/prepared';

const typed = (answer: string, alternatives: string[] = []) => ({
  format: 'translation' as const,
  answer,
  alternatives
});

describe('typedMatchKey', () => {
  it('ignores case, extra spaces, apostrophe style and final punctuation', () => {
    expect(typedMatchKey('  Anna   parle L’italien ! ')).toBe(
      typedMatchKey("anna parle l'italien")
    );
    expect(typedMatchKey('Ça va ?')).toBe(typedMatchKey('ça va'));
  });

  it('keeps accents, inner punctuation and every other character', () => {
    expect(typedMatchKey('Le bebe pleure.')).not.toBe(
      typedMatchKey('Le bébé pleure.')
    );
    expect(typedMatchKey('Strasse')).not.toBe(typedMatchKey('Straße'));
    expect(typedMatchKey('Ja, ich komme.')).not.toBe(
      typedMatchKey('Ja ich komme.')
    );
    // Only one final mark is ignored, not punctuation in general.
    expect(typedMatchKey('Wirklich?!')).not.toBe(typedMatchKey('Wirklich'));
  });

  it('treats decomposed and composed accents as the same letter', () => {
    expect(typedMatchKey('été')).toBe(typedMatchKey('été'));
  });
});

describe('evaluatePrepared', () => {
  it('accepts the answer and every rubric alternative of a typed question', () => {
    const question = typed('Anna parle italien.', ["Anna parle l'italien."]);
    expect(evaluatePrepared(question, 'anna parle italien')).toBe('correct');
    expect(evaluatePrepared(question, 'Anna parle l’italien')).toBe('correct');
  });

  it('leaves an unmatched typed answer uncertain for the fallback', () => {
    const question = typed('Le bébé pleure.');
    expect(evaluatePrepared(question, 'Le bebe pleure.')).toBe('uncertain');
    expect(evaluatePrepared(question, 'Le bébé pleurer.')).toBe('uncertain');
  });

  it('applies the same rule to typed blanks and corrections', () => {
    expect(
      evaluatePrepared(
        { format: 'typed-blank', answer: 'dort', alternatives: [] },
        ' Dort '
      )
    ).toBe('correct');
    expect(
      evaluatePrepared(
        { format: 'correction', answer: 'Je suis ici.', alternatives: [] },
        'je suis ici'
      )
    ).toBe('correct');
  });

  it('marks multiple choice correct only for the exact answer', () => {
    const question = {
      format: 'multiple-choice' as const,
      answer: 'Marie travaille.',
      alternatives: ['Marie travaille.', 'Marie travailler.']
    };
    expect(evaluatePrepared(question, 'Marie travaille.')).toBe('correct');
    // Options are not accepted answers, and no typed leniency applies.
    expect(evaluatePrepared(question, 'Marie travailler.')).toBe('incorrect');
    expect(evaluatePrepared(question, 'marie travaille')).toBe('incorrect');
  });

  it('is uncertain when the question has no stored answer', () => {
    expect(
      evaluatePrepared(
        { format: 'translation', answer: null, alternatives: [] },
        'Paul travaille.'
      )
    ).toBe('uncertain');
  });

  it('names its version', () => {
    expect(PREPARED_EVALUATOR_VERSION).toMatch(/^prepared-\d+$/);
  });
});
