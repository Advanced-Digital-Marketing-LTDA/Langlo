import { describe, expect, it } from 'vitest';
import {
  evaluatePrepared,
  PREPARED_EVALUATOR_VERSION,
  typedMatchKey
} from '../src/lib/server/evaluation/prepared';
import { normalize } from './fixtures/curriculum-module';

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
    expect(typedMatchKey('Ja. ich komme')).not.toBe(
      typedMatchKey('Ja ich komme')
    );
    // Backticks and acute accents are characters, not apostrophes.
    expect(typedMatchKey('l`italien')).not.toBe(typedMatchKey("l'italien"));
    expect(typedMatchKey('l´italien')).not.toBe(typedMatchKey("l'italien"));
  });

  it('ignores a run of final marks, as the curriculum rule does', () => {
    expect(typedMatchKey('Wirklich?!')).toBe(typedMatchKey('Wirklich'));
    expect(typedMatchKey("J'habite à Paris ?!")).toBe(
      typedMatchKey("J'habite à Paris")
    );
  });

  it('agrees with the curriculum contract normalization', () => {
    const probes = [
      '  j’habite   à paris ',
      "J'habite à Paris!",
      "J'HABITE À PARIS",
      "J'habite à Paris?!",
      "J'habite. à Paris",
      'J\u2018habite',
      'J\u2019habite',
      'J\u02bchabite',
      'J\u201bhabite',
      'l`italien',
      'l´italien',
      'est-ce que tu aimes la musique\u00a0?',
      "J'habite a\u0300 Paris".normalize('NFD'),
      'Wirklich . ! ?',
      '...',
      ' Ça va ? '
    ];
    for (const probe of probes)
      expect(typedMatchKey(probe), probe).toBe(normalize(probe));
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

  it('applies no trimming or Unicode normalization to multiple choice', () => {
    const question = {
      format: 'multiple-choice' as const,
      answer: 'Il a été là.',
      alternatives: ['Il a été là.', 'Il a ete là.']
    };
    expect(evaluatePrepared(question, ' Il a été là. ')).toBe('incorrect');
    expect(evaluatePrepared(question, 'Il a été là.'.normalize('NFD'))).toBe(
      'incorrect'
    );
  });

  it('never matches an answer or rubric that normalizes to nothing', () => {
    expect(evaluatePrepared(typed('?!'), '!')).toBe('uncertain');
    expect(evaluatePrepared(typed('Oui.', ['.']), '...')).toBe('uncertain');
    expect(evaluatePrepared(typed('Oui.', ['.']), 'oui')).toBe('correct');
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
