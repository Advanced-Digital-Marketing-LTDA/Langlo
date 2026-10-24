import { afterAll, expect, it } from 'vitest';
import { closeRenderServer, renderSvelte } from './helpers/render-svelte';

const page = 'src/routes/app/review/flashcards/+page.svelte';
const settingsPage = 'src/routes/app/settings/+page.svelte';
const card = (kind: 'basic' | 'cloze', content: object) => ({
  id: 'card-1',
  revision: 0,
  kind,
  deck: 'Greetings',
  content,
  explanation: 'A short memory cue.',
  intervals: { again: '10m', hard: '10m', good: '1d', easy: '3d' }
});
const data = (cards: unknown[]) => ({
  cards,
  total: cards.length,
  unavailableCount: 0,
  language: 'fr',
  submissionKey: 'key'
});

afterAll(closeRenderServer);

it('shows the front and a Show answer button, with no answer or rating buttons yet', async () => {
  const html = await renderSvelte(page, {
    data: data([card('basic', { front: 'Bonjour?', back: 'Hello' })]),
    form: null
  });
  expect(html).toContain('Bonjour?');
  expect(html).toContain('Show answer');
  expect(html).toContain('data-testid="remaining-due"');
  expect(html).toContain('1 due');
  expect(html).not.toContain('A short memory cue.');
  expect(html).not.toContain('Hello');
  for (const rating of ['again', 'hard', 'good', 'easy'])
    expect(html).not.toContain(`value="${rating}"`);
});

it('hides the cloze answer until it is shown', async () => {
  const html = await renderSvelte(page, {
    data: data([card('cloze', { text: 'Je {{c1::suis}} ici' })]),
    form: null
  });
  expect(html).toContain('Je [...] ici');
  expect(html).not.toContain('suis');
});

it('says nothing is due when there are no cards', async () => {
  const html = await renderSvelte(page, { data: data([]), form: null });
  expect(html).toContain('Nothing is due right now.');
  expect(html).not.toContain('Show answer');
});

it('shows a readable due card while reporting one unavailable card', async () => {
  const html = await renderSvelte(page, {
    data: {
      ...data([card('basic', { front: 'Bonjour', back: 'Hello' })]),
      total: 2,
      unavailableCount: 1
    },
    form: null
  });
  expect(html).toContain('1 due card needs repair');
  expect(html).toContain('Bonjour');
});

it('explains that saved timezones set day-based review times', async () => {
  const html = await renderSvelte(settingsPage, {
    data: {
      enrollments: [],
      explanationLanguages: [],
      timezone: null,
      studySchedule: {
        desiredRetention: 90,
        newCardPreset: '1m+10m',
        relearningPreset: '10m'
      }
    },
    form: null
  });
  const text = html.replace(/\s+/gu, ' ');
  expect(text).toContain(
    'Your study day starts at 04:00 in your saved timezone.'
  );
  expect(text).toContain('UTC applies until you save one.');
});

const reviewTab = 'src/routes/app/review/+page.svelte';
const tabData = {
  languages: ['fr', 'de', 'unassigned'],
  language: 'fr',
  submissionKey: 'key',
  flashcards: { overdue: 2, today: 3, todayReady: 0, nextDueAt: '16:30' },
  grammar: {
    overdue: [{ skillId: 'fr-a1-001', title: 'Être', dueAt: 1, ready: true }],
    today: [],
    nextDueAt: null
  }
};

it('lets the learner switch language and go to overdue or today reviews', async () => {
  const html = await renderSvelte(reviewTab, { data: tabData, form: null });
  expect(html).toMatch(/aria-pressed="true"[^>]*>French</);
  expect(html).toContain('>German<');
  expect(html).toContain('>Unassigned<');
  expect(html).toContain(
    'href="/app/review/flashcards?language=fr&amp;due=overdue"'
  );
  expect(html).toContain('2 cards');
  expect(html).toContain('3 cards');
  // Today's cards are not due yet, so there is no button, only the next time.
  expect(html).not.toContain('due=today');
  expect(html).toContain('Next card is due at 16:30.');
  expect(html).toContain('Review overdue grammar');
  expect(html).not.toContain("Review today's grammar");
  expect(html).toContain('0 topics');
});

it('asks for a language when the learner has none', async () => {
  const html = await renderSvelte(reviewTab, {
    data: { languages: [], language: null, submissionKey: '' },
    form: null
  });
  expect(html).toContain('You have no enrolled language tracks yet.');
});
