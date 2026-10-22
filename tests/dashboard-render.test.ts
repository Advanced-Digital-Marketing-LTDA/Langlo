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
  policyVersion: 'grammar-1',
  retention: {
    state: 'not-assessed',
    dueAt: null,
    lastReviewedAt: null,
    retrievability: null,
    target: 0.9
  }
});
const track = (recommendedId: string | null) => ({
  language: 'fr',
  level: 'A1',
  skills: [skill('fr-a1-001', 'weak'), skill('fr-a1-002', 'secure')],
  recommendation: recommendedId
    ? { skillId: recommendedId, reason: 'Revisit this first' }
    : null
});
const data = (
  tracks: unknown[],
  unfinished: Record<string, { id: string; answered: number }> = {}
) => ({
  user: { name: 'Ada', email: 'ada@example.com' },
  tracks,
  unfinished
});

beforeEach(() => setAppState({}));
afterAll(closeRenderServer);

it('shows the Continue card with the recommended skill and its lesson link', async () => {
  const html = await renderSvelte(page, { data: data([track('fr-a1-002')]) });
  expect(html).toContain('Welcome back, Ada');
  expect(html).toContain('Signed in as Ada.');
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

it('shows the sign-out failure as an alert with a retry button', async () => {
  const html = await renderSvelte(page, {
    data: data([]),
    form: { message: 'Sign out is temporarily unavailable. Try again.' }
  });
  expect(html).toMatch(
    /role="alert"[^>]*>\s*Sign out is temporarily unavailable\. Try again\./
  );
  expect(html).toContain('action="?/signOut"');
  expect(html).toContain('Sign out</button>');
});

it('links dashboard topics to their language and selected map topic', async () => {
  const html = await renderSvelte(page, {
    data: data([
      { ...track(null), language: 'en', skills: [skill('en-a1-001', 'weak')] },
      track(null)
    ])
  });
  expect(html).toContain('href="/app/map?language=en&amp;skill=en-a1-001"');
  expect(html).toContain('href="/app/map?language=fr&amp;skill=fr-a1-002"');
});

it('hides unavailable skills from the list, counts and links', async () => {
  const html = await renderSvelte(page, {
    data: data([
      {
        ...track(null),
        skills: [skill('fr-a1-001', 'weak'), skill('gone', 'unknown')].map(
          (item) =>
            item.skillId === 'gone' ? { ...item, available: false } : item
        )
      }
    ])
  });
  expect(html).toContain('of 1 topics');
  expect(html).toContain('Title fr-a1-001');
  expect(html).not.toContain('Title gone');
});

it('says so when every skill is unavailable', async () => {
  const html = await renderSvelte(page, {
    data: data([
      {
        ...track(null),
        skills: [{ ...skill('gone', 'unknown'), available: false }]
      }
    ])
  });
  expect(html).toContain(
    'No published skills are available in this track yet.'
  );
});

it('says so when a track has no published skills', async () => {
  const html = await renderSvelte(page, {
    data: data([{ ...track(null), skills: [] }])
  });
  expect(html).toContain(
    'No published skills are available in this track yet.'
  );
  expect(html).not.toContain('Grammar mastery');
  expect(html).not.toContain('Full skill map');
});

it('links to the unfinished practice of a track, and only when there is one', async () => {
  const withSession = await renderSvelte(page, {
    data: data([track(null)], { fr: { id: 'practice:abc', answered: 3 } })
  });
  expect(withSession).toContain('href="/app/session/practice%3Aabc"');
  expect(withSession).toContain('Continue practice');
  expect(withSession).toMatch(/3\s+answers so far/);
  const without = await renderSvelte(page, { data: data([track(null)]) });
  expect(without).not.toContain('/app/session/');
});

it('shows the empty state with a way to start when there are no tracks', async () => {
  const html = await renderSvelte(page, { data: data([]) });
  expect(html).toContain('Start with the grammar assessment');
  expect(html).toContain('href="/app/assessment"');
  expect(html).not.toContain('Grammar mastery');
});

it('shows daily grammar and flashcard review counts without grammar tracks', async () => {
  const html = await renderSvelte(page, {
    data: {
      ...data([]),
      reviewDueByDay: [
        { date: '2026-10-22', grammar: 2, flashcards: 3, total: 5 },
        { date: '2026-10-23', grammar: 0, flashcards: 0, total: 0 }
      ]
    }
  });
  expect(html).toContain('Reviews due by day');
  expect(html).toContain('Grammar reviews');
  expect(html).toContain('Flashcards');
  expect(html).toContain('2026-10-22');
  expect(html).toMatch(/2\s*<\/td>/);
  expect(html).toMatch(/3\s*<\/td>/);
  expect(html).toMatch(/5\s*<\/td>/);
});

it('explains when there are no reviews due in the displayed study days', async () => {
  const html = await renderSvelte(page, {
    data: {
      ...data([]),
      reviewDueByDay: Array.from({ length: 7 }, (_, index) => ({
        date: `2026-10-${String(22 + index).padStart(2, '0')}`,
        grammar: 0,
        flashcards: 0,
        total: 0
      }))
    }
  });
  expect(html).toContain('No reviews are due in the next seven study days.');
});

it('removes Progress from study navigation', async () => {
  const html = await renderSvelte(layout, { children });
  expect(html).not.toContain('href="/app/progress"');
  expect(html).toContain('href="/app/map"');
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

it('uses neutral scheduled wording and distinguishes due from overdue', async () => {
  const html = await renderSvelte(progress, {
    tracks: [
      {
        ...track(null),
        skills: [
          {
            ...skill('scheduled', 'unknown'),
            retention: {
              ...skill('x', 'unknown').retention,
              state: 'scheduled'
            }
          },
          {
            ...skill('due', 'unknown'),
            retention: { ...skill('x', 'unknown').retention, state: 'due' }
          },
          {
            ...skill('overdue', 'unknown'),
            retention: { ...skill('x', 'unknown').retention, state: 'overdue' }
          },
          {
            ...skill('below-target', 'unknown'),
            retention: {
              ...skill('x', 'unknown').retention,
              state: 'below-target'
            }
          }
        ]
      }
    ]
  });
  expect(html).toContain('Scheduled for retrieval practice');
  expect(html).toContain('Due for retrieval practice');
  expect(html).toContain('Overdue for retrieval practice');
  expect(html).toContain('Estimated recall below your target');
  expect(html).not.toContain('Estimated recall above your target');
});

it('no longer renders its own navigation', async () => {
  const html = await renderSvelte(progress, { tracks: [track(null)] });
  expect(html).not.toContain('Study navigation');
});

it('shows practice counts only when GrammarProgress is asked to', async () => {
  const counted = {
    ...track(null),
    skills: [
      { ...skill('fr-a1-001', 'weak'), practisedSessions: 2, answers: 3 }
    ]
  };
  const without = await renderSvelte(progress, { tracks: [counted] });
  expect(without).not.toContain('Practice counts include');
  expect(without).not.toContain('Practised 2 times');
  const withCounts = await renderSvelte(progress, {
    tracks: [counted],
    practiceCounts: true
  });
  expect(withCounts).toContain('Practice counts include');
  expect(withCounts).toContain('Practised 2 times · 3 answers');
});
