import { afterAll, beforeEach, expect, it } from 'vitest';
import { closeRenderServer, renderSvelte } from './helpers/render-svelte';
import { setAppState } from './helpers/app-state-stub';

const page = 'src/routes/app/analytics/+page.svelte';
const days = [
  {
    date: '2026-10-22',
    flashcardsCompleted: 0,
    grammarCompleted: 0,
    flashcardsScheduled: 0,
    grammarScheduled: 0
  }
];

beforeEach(() => setAppState({}));
afterAll(closeRenderServer);

// The text of each cell in the study-time row for `date`.
function studyRow(html: string, date: string): string[] {
  const table = html.slice(html.indexOf('aria-label="Study time by day"'));
  const row = table
    .split('<tr')
    .find((part) => part.includes(`datetime="${date}"`));
  if (!row) throw new Error(`no study-time row for ${date}`);
  return [...row.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1].trim());
}

it('renders the study-time chart and table below the review analytics', async () => {
  const html = await renderSvelte(page, {
    data: {
      days,
      studyTime: [
        { date: '2026-10-20', flashcardsSeconds: null, grammarSeconds: null },
        { date: '2026-10-21', flashcardsSeconds: 90, grammarSeconds: 0 },
        { date: '2026-10-22', flashcardsSeconds: 600, grammarSeconds: 333 }
      ]
    }
  });

  expect(html.indexOf('Review history and scheduled reviews')).toBeLessThan(
    html.indexOf('Study time by day')
  );
  expect(html).toContain('aria-label="Minutes studied by study day"');
  expect(html).toContain('Flashcards (min)');
  expect(html).toContain('Grammar (min)');
  expect(html).toContain('Total (min)');
  expect(studyRow(html, '2026-10-20')).toEqual([
    'No Data',
    'No Data',
    'No Data'
  ]);
  expect(studyRow(html, '2026-10-21')).toEqual(['1.5', '0', '1.5']);
  expect(studyRow(html, '2026-10-22')).toEqual(['10', '5.6', '15.6']);
});

it('shows No Data for the chart and table when no study time is recorded', async () => {
  const html = await renderSvelte(page, {
    data: {
      days,
      studyTime: [
        { date: '2026-10-22', flashcardsSeconds: null, grammarSeconds: null }
      ]
    }
  });

  expect(html).toContain('Study time');
  expect(html.match(/<p>No Data<\/p>/g)).toHaveLength(2);
  expect(html).not.toContain('aria-label="Minutes studied by study day"');
  expect(html).not.toContain('aria-label="Study time by day"');
});
