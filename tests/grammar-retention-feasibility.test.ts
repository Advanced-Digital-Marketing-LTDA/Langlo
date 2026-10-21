import { expect, it } from 'vitest';
import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  type Card,
  type Grade
} from 'ts-fsrs';

const start = new Date('2026-01-01T12:00:00.000Z');
const ratings: Grade[] = [
  Rating.Good,
  Rating.Easy,
  Rating.Hard,
  Rating.Good,
  Rating.Easy,
  Rating.Good
];

function schedule(card: Card, rating: Grade, day: number): Card {
  const scheduler = fsrs(
    generatorParameters({
      enable_fuzz: false,
      enable_short_term: true,
      learning_steps: ['1m', '10m'],
      relearning_steps: ['10m'],
      request_retention: 0.9
    })
  );
  return scheduler.next(
    card,
    new Date(start.getTime() + day * 24 * 60 * 60 * 1000),
    rating
  ).card;
}

it('shows how one skill schedule accrues reviews across varied new questions', () => {
  let skill = createEmptyCard(start);
  const separateQuestions = ratings.map((rating, index) => {
    const firstSeen = createEmptyCard(
      new Date(start.getTime() + index * 24 * 60 * 60 * 1000)
    );
    return schedule(firstSeen, rating, index);
  });

  ratings.forEach((rating, index) => {
    skill = schedule(skill, rating, [0, 1, 3, 7, 14, 30][index]);
  });

  expect(skill.reps).toBe(ratings.length);
  expect(separateQuestions.every((card) => card.reps === 1)).toBe(true);
  expect(skill.stability).toBeGreaterThan(
    Math.max(...separateQuestions.map((card) => card.stability))
  );
  expect(skill.stability).toBeCloseTo(116.46002236, 6);
  expect(skill.due.toISOString()).toBe('2026-05-27T12:00:00.000Z');
  expect(Math.max(...separateQuestions.map((card) => card.stability))).toBe(
    8.2956
  );
});

it('exposes the four learner ratings in the installed scheduler', () => {
  const preview = fsrs(generatorParameters({ enable_fuzz: false })).repeat(
    createEmptyCard(start),
    start
  );

  expect(Object.keys(preview).sort()).toEqual(['1', '2', '3', '4']);
  expect(preview[Rating.Again].card.reps).toBe(1);
  expect(preview[Rating.Hard].card.reps).toBe(1);
  expect(preview[Rating.Good].card.reps).toBe(1);
  expect(preview[Rating.Easy].card.reps).toBe(1);
});
