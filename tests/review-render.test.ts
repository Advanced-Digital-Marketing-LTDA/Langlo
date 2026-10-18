import { afterAll, expect, it } from 'vitest';
import { closeRenderServer, renderSvelte } from './helpers/render-svelte';

const page = 'src/routes/app/review/+page.svelte';
const card = (kind: 'basic' | 'cloze', content: object) => ({
  id: 'card-1',
  revision: 0,
  kind,
  deck: 'Greetings',
  content
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
