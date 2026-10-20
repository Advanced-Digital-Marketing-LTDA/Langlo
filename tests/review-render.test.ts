import { afterAll, expect, it } from 'vitest';
import { closeRenderServer, renderSvelte } from './helpers/render-svelte';

const page = 'src/routes/app/review/+page.svelte';
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
