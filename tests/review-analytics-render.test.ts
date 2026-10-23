import { afterAll, beforeEach, expect, it } from 'vitest';
import { closeRenderServer, renderSvelte } from './helpers/render-svelte';
import { setAppState } from './helpers/app-state-stub';

const page = 'src/routes/app/analytics/+page.svelte';

beforeEach(() => setAppState({}));
afterAll(closeRenderServer);

it('renders the review graph and table with completed and scheduled series', async () => {
  const html = await renderSvelte(page, {
    data: {
      days: [
        {
          date: '2025-10-22',
          flashcardsCompleted: 1,
          grammarCompleted: 2,
          flashcardsScheduled: null,
          grammarScheduled: null
        },
        {
          date: '2026-10-22',
          flashcardsCompleted: 0,
          grammarCompleted: 0,
          flashcardsScheduled: 3,
          grammarScheduled: 4
        }
      ]
    }
  });

  expect(html).toContain('<h1>Review analytics</h1>');
  expect(html).toContain(
    'aria-label="Actual completed reviews and currently scheduled reviews by study day"'
  );
  expect(html).toContain('Flashcards completed');
  expect(html).toContain('Grammar completed');
  expect(html).toContain('Flashcards scheduled');
  expect(html).toContain('Grammar scheduled');
  expect(html).toContain('Review history and scheduled reviews');
  expect(html).toContain('2025-10-22');
  expect(html).toContain('2026-10-22');
  expect(html).not.toContain('forecast');
});
