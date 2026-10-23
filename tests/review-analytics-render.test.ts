import { afterAll, beforeEach, expect, it } from 'vitest';
import { closeRenderServer, renderSvelte } from './helpers/render-svelte';
import { setAppState } from './helpers/app-state-stub';

const page = 'src/routes/app/analytics/+page.svelte';

beforeEach(() => setAppState({}));

// The text of each cell in the table row for `date`, after the row header.
function rowCells(html: string, date: string): string[] {
  const row = html
    .split('<tr')
    .find((part) => part.includes(`datetime="${date}"`));
  if (!row) throw new Error(`no table row for ${date}`);
  return [...row.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1].trim());
}
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
  expect(rowCells(html, '2025-10-22')).toEqual(['1', '2', '3', '—', '—', '—']);
  expect(rowCells(html, '2026-10-22')).toEqual(['0', '0', '0', '3', '4', '7']);
  // Scheduled work exists only today, so each scheduled series is one point and needs a marker.
  expect(html.match(/<circle[^>]*class="point"/g)).toHaveLength(2);
});
