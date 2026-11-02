import { vi } from 'vitest';
import { SYSTEM_ONE_URL } from '../../src/lib/server/evaluation/typesafe-jev';

export const guardKeys = {
  openAi: 'synthetic-openai-test-key',
  typesafe: 'synthetic-typesafe-test-key'
};

/** A Jev guard answer: `noul` is the probability the text holds instructions. */
export const guardAnswer = (noul: number) =>
  Response.json({ answers: { injection: { type: 'noul', noul } } });

/** Routes the Jev guard call to a fixed answer and everything else to `openAi`. */
export function withGuard(
  openAi: (input: unknown, init?: RequestInit) => unknown,
  noul = 0.01
) {
  return vi.fn(async (input: unknown, init?: RequestInit) =>
    String(input) === String(SYSTEM_ONE_URL)
      ? guardAnswer(noul)
      : openAi(input, init)
  );
}
