import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  evaluatePrepared,
  PREPARED_MATCHING_RULE
} from '../src/lib/server/evaluation/prepared';

// Every checked content module is the evaluator's corpus: its answers and
// rubric alternatives must be accepted, and no authored near miss may pass.

type Question = {
  id: string;
  format: 'multiple-choice' | 'typed-blank' | 'translation' | 'correction';
  answer: string;
  alternatives?: string[];
  near_misses?: string[];
};
type Module = {
  module_id: string;
  matching: string;
  lessons: { version: { questions: Question[] } }[];
};

const root = join(import.meta.dirname, '..', 'content');
const modules: Module[] = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((track) =>
    readdirSync(join(root, track.name))
      .filter((name) => name.endsWith('.json'))
      .map(
        (name) =>
          JSON.parse(
            readFileSync(join(root, track.name, name), 'utf8')
          ) as Module
      )
  );
const questions = modules.flatMap((module) =>
  module.lessons.flatMap((lesson) => lesson.version.questions)
);

const evaluate = (question: Question, answer: string) =>
  evaluatePrepared(
    {
      format: question.format,
      answer: question.answer,
      alternatives: question.alternatives ?? []
    },
    answer
  );

describe('prepared-answer corpus', () => {
  it('covers the checked content', () => {
    expect(modules.length).toBeGreaterThan(20);
    expect(questions.length).toBeGreaterThan(1000);
  });

  it('implements the matching rule every module states', () => {
    for (const module of modules)
      expect(module.matching, module.module_id).toBe(PREPARED_MATCHING_RULE);
  });

  it('accepts every answer and typed rubric alternative', () => {
    for (const question of questions) {
      expect(evaluate(question, question.answer), question.id).toBe('correct');
      if (question.format === 'multiple-choice') continue;
      for (const alternative of question.alternatives ?? [])
        expect(evaluate(question, alternative), question.id).toBe('correct');
    }
  });

  it('marks every other multiple-choice option incorrect', () => {
    for (const question of questions) {
      if (question.format !== 'multiple-choice') continue;
      for (const option of question.alternatives ?? [])
        if (option !== question.answer)
          expect(evaluate(question, option), question.id).toBe('incorrect');
    }
  });

  it('never accepts an authored near miss', () => {
    const nearMisses = questions.flatMap((question) =>
      (question.near_misses ?? []).map((miss) => ({ question, miss }))
    );
    expect(nearMisses.length).toBeGreaterThan(1000);
    for (const { question, miss } of nearMisses)
      expect(evaluate(question, miss), `${question.id}: ${miss}`).not.toBe(
        'correct'
      );
  });
});
