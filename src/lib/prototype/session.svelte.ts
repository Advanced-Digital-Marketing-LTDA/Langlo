/* global $state */
// Shared synthetic session state for the T005 prototype. In-memory only —
// resets on reload; no persistence and no backend, matching the fixture data.
import { decks as fixtureDecks } from './data';
import type { SessionAnswer } from './results';

export const prototypeSession = $state({
  decks: globalThis.structuredClone(fixtureDecks),
  showAnkiExport: true,
  // Learner answers recorded during a practice run; kept drafts persist in
  // deck notes so a keep stays kept across in-session navigation.
  answers: [] as SessionAnswer[]
});
