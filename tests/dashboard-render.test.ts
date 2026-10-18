import { afterAll, beforeEach, expect, it } from 'vitest';
import { closeRenderServer, renderSvelte } from './helpers/render-svelte';
import { setAppState } from './helpers/app-state-stub';
import { masteryLabels, masterySymbols } from '../src/lib/dashboard';

const page = 'src/routes/app/+page.svelte';
const layout = 'src/routes/app/+layout.svelte';
const progress = 'src/lib/components/GrammarProgress.svelte';

const skill = (skillId: string, status: string, level = 'A1') => ({
  skillId,
  title: `Title ${skillId}`,
  level,
  status,
  prerequisites: [],
  available: true,
  independentItems: 0,
  sessions: 0,
  correct: 0,
  incorrect: 0,
  reason: `Reason ${skillId}`,
  policyVersion: 'grammar-1'
});
const track = (recommendedId: string | null) => ({
  language: 'fr',
  level: 'A1',
  skills: [skill('fr-a1-001', 'weak'), skill('fr-a1-002', 'secure')],
  recommendation: recommendedId
    ? { skillId: recommendedId, reason: 'Revisit this first' }
    : null
});
const data = (tracks: unknown[]) => ({
  user: { name: 'Ada', email: 'ada@example.com' },
  tracks
});

beforeEach(() => setAppState({}));
afterAll(closeRenderServer);

it('shows the Continue card with the recommended skill and its lesson link', async () => {
  const html = await renderSvelte(page, { data: data([track('fr-a1-002')]) });
  expect(html).toContain('Welcome back, Ada');
  expect(html).toContain('Continue');
  expect(html).toContain('Title fr-a1-002');
  expect(html).toContain('Revisit this first');
  expect(html).toContain('href="/app/learn/fr/lesson/fr-a1-002"');
  expect(html).toContain('Sign out');
});

it('omits the Continue card when nothing is recommended', async () => {
  const html = await renderSvelte(page, { data: data([track(null)]) });
  expect(html).not.toContain('Open lesson');
  expect(html).toContain('Grammar mastery');
});

it('shows the empty state with a way to start when there are no tracks', async () => {
  const html = await renderSvelte(page, { data: data([]) });
  expect(html).toContain('Start with the grammar assessment');
  expect(html).toContain('href="/app/assessment"');
  expect(html).not.toContain('Grammar mastery');
});

it('shows a busy skeleton instead of content while navigating', async () => {
  setAppState({ navigatingTo: { url: new URL('http://127.0.0.1/app/map') } });
  const html = await renderSvelte(page, { data: data([track('fr-a1-001')]) });
  expect(html).toContain('aria-busy="true"');
  expect(html).not.toContain('Title fr-a1-001');
});

const children = (renderer: { push: (html: string) => void }) =>
  renderer.push('<p>child content</p>');
const current = (html: string) =>
  [...html.matchAll(/<a href="([^"]+)"[^>]*aria-current="page"/g)].map(
    (match) => match[1]
  );

it('marks only Home current on the exact /app path', async () => {
  setAppState({ pathname: '/app' });
  const html = await renderSvelte(layout, { children });
  expect(current(html)).toEqual(['/app']);
  expect(html).toContain('child content');
});

it('marks the nested route current and not Home', async () => {
  setAppState({ pathname: '/app/map' });
  expect(current(await renderSvelte(layout, { children }))).toEqual([
    '/app/map'
  ]);
  setAppState({ pathname: '/app/assessment/session/s1/results' });
  expect(current(await renderSvelte(layout, { children }))).toEqual([
    '/app/assessment'
  ]);
});

it('does not mark a tab for a sibling path sharing its prefix', async () => {
  setAppState({ pathname: '/app/mapx' });
  expect(current(await renderSvelte(layout, { children }))).toEqual([]);
});

it('treats a trailing slash like the bare path', async () => {
  setAppState({ pathname: '/app/' });
  expect(current(await renderSvelte(layout, { children }))).toEqual(['/app']);
});

it('renders GrammarProgress status with the shared labels and symbols', async () => {
  const html = await renderSvelte(progress, {
    tracks: [
      {
        ...track(null),
        skills: Object.keys(masteryLabels).map((status) =>
          skill(`s-${status}`, status)
        )
      }
    ]
  });
  for (const status of Object.keys(
    masteryLabels
  ) as (keyof typeof masteryLabels)[]) {
    const chip = new RegExp(
      `${masterySymbols[status].replace(/[!]/g, '\\$&')}</span>\\s*${masteryLabels[status]}`
    );
    expect(html).toMatch(chip);
  }
});

it('no longer renders its own navigation', async () => {
  const html = await renderSvelte(progress, { tracks: [track(null)] });
  expect(html).not.toContain('Study navigation');
});
