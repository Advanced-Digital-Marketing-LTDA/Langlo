import { expect, type Page } from '@playwright/test';
import { test as base } from './coverage-fixture';

// Every prototype navigation waits for hydration: a click on a server-rendered
// button before its handler attaches is silently lost.
const test = base.extend({
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page);
    page.goto = async (url, options) => {
      const response = await goto(url, options);
      if (url.startsWith('/prototype'))
        await page.locator('.prototype[data-hydrated]').waitFor();
      return response;
    };
    await use(page);
  }
});

// Two incorrect typed answers ('es', 'je mange') out of four items.
const TWO_MISS_RESPONSES = ['es', 'allons', 'je mange', 'je vais au marché'];
// Every item answered correctly.
const ALL_CORRECT_RESPONSES = [
  'est',
  'allons',
  'je vais manger',
  'je vais au marché'
];

// Answer the four practice items in order; the first is the multiple-choice
// item, the rest are typed inputs. Ends on the results page.
async function answerPracticeItems(page: Page, responses: string[]) {
  for (const [index, response] of responses.entries()) {
    if (index === 0) {
      await page.getByRole('radio', { name: response, exact: true }).check();
    } else {
      await page.getByRole('textbox', { name: 'Your answer' }).fill(response);
    }
    await page.getByRole('button', { name: 'Submit answer' }).click();
    if (index === responses.length - 1) {
      await page.getByRole('link', { name: 'See results' }).click();
    } else {
      await page.getByRole('button', { name: 'Next item' }).click();
    }
  }
}

async function completePractice(page: Page, responses: string[]) {
  await page.goto('/prototype/practice');
  await answerPracticeItems(page, responses);
}

// Navigate results → decks via the 'See card drafts' link.
async function goToDrafts(page: Page) {
  await Promise.all([
    page.waitForURL('**/prototype/decks'),
    page.getByRole('link', { name: 'See card drafts' }).click()
  ]);
}

// Visit drafts and return — exercises keep state across a remount.
async function draftsRoundTrip(page: Page) {
  await goToDrafts(page);
  await page.goBack();
}

const prototypePages = [
  '/prototype',
  '/prototype/map',
  '/prototype/lesson',
  '/prototype/practice',
  '/prototype/results',
  '/prototype/review',
  '/prototype/decks',
  '/prototype/settings'
];

test('prototype screens are reachable, labelled, and marked noindex', async ({
  page,
  request
}) => {
  const response = await request.get('/prototype');
  expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow');
  expect(response.headers()['cache-control']).toBe('no-store');

  for (const path of prototypePages) {
    await page.goto(path);
    await expect(
      page.getByText('Design prototype — synthetic data', { exact: false })
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
});

test('prototype screens show their alternate loading, empty, error, and evaluation states', async ({
  page
}) => {
  const states = [
    ['/prototype', 'loading', 'Loading your study overview'],
    ['/prototype', 'empty', 'Start your first lesson'],
    ['/prototype', 'error', 'Overview unavailable'],
    ['/prototype/map', 'loading', 'Loading French A1 skills'],
    ['/prototype/map', 'empty', 'No published skills yet'],
    ['/prototype/map', 'error', 'Map unavailable'],
    ['/prototype/lesson', 'loading', 'Loading lesson…'],
    ['/prototype/lesson', 'error', 'Lesson unavailable'],
    ['/prototype/lesson', 'unavailable', 'Content temporarily unavailable'],
    ['/prototype/practice', 'loading', 'Preparing your next exercise'],
    ['/prototype/practice', 'error', 'Answer could not be submitted'],
    ['/prototype/results', 'loading', 'Loading your results'],
    ['/prototype/results', 'error', 'Results unavailable'],
    ['/prototype/results', 'evaluating', 'One item is still being evaluated'],
    ['/prototype/review', 'loading', 'Loading your due cards'],
    ['/prototype/review', 'error', 'Card could not be loaded'],
    ['/prototype/decks', 'loading', 'Loading your decks'],
    ['/prototype/decks', 'empty', 'No decks yet'],
    ['/prototype/decks', 'error', 'Decks unavailable'],
    ['/prototype/settings', 'error', 'Could not save']
  ] as const;

  for (const [path, state, expected] of states) {
    await page.goto(path);
    await page
      .getByRole('navigation', { name: 'Prototype screen states' })
      .getByRole('link', { name: state, exact: true })
      .click();
    await expect(
      page.getByText(expected, { exact: false }).first()
    ).toBeVisible();
  }
});

test('review flow reveals and rates cards by keyboard', async ({ page }) => {
  await page.goto('/prototype/review');
  // Space/Enter on the page body is the documented reveal shortcut; wait for
  // hydration to attach the key handler before pressing.
  await page.waitForLoadState('networkidle');
  await page.keyboard.press('Enter');
  const again = page.getByRole('button', { name: /^again/iu });
  await expect(again).toBeVisible();
  await expect(again).toBeFocused();
  await page.keyboard.press('3');
  await expect(page.getByRole('status')).toContainText('Card 2 of 3');
  await page.keyboard.press(' ');
  await page.keyboard.press('1');
  await page.keyboard.press(' ');
  await page.keyboard.press('4');
  await expect(
    page.getByRole('heading', { name: /all caught up/iu })
  ).toBeVisible();
});

test('review cards can also be revealed and rated by pointer', async ({
  page
}) => {
  await page.goto('/prototype/review');
  for (const rating of ['Easy', 'Again', 'Hard']) {
    await page.getByRole('button', { name: /reveal answer/i }).click();
    await page
      .getByRole('button', { name: new RegExp(`^${rating}`, 'iu') })
      .click();
  }
  await expect(
    page.getByRole('heading', { name: /all caught up/iu })
  ).toBeVisible();
  await expect(
    page.getByText(/you rated 3 cards this session \(last rating: hard\)/iu)
  ).toBeVisible();
});

test('map explains access to a track without enrollment', async ({ page }) => {
  await page.goto('/prototype/map');
  await page.getByRole('link', { name: 'German A1' }).click();
  await expect(
    page.getByRole('heading', { name: 'Curriculum map' })
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /recognize grammatical gender/i })
  ).toBeVisible();
  await page.getByRole('link', { name: /german a2.*not enrolled/iu }).click();
  await expect(
    page.getByRole('heading', { name: 'Not enrolled in German A2' })
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open settings' })).toBeVisible();
});

test('settings save the selected preferences in the prototype session', async ({
  page
}) => {
  await page.goto('/prototype/settings');
  await page.getByLabel('Your timezone').selectOption('Europe/Lisbon');
  await page.getByLabel('Day boundary for due queues').fill('05:30');
  await page.getByLabel('Daily review cap').fill('25');
  await page.getByLabel('New cards per day').fill('5');
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByRole('status')).toContainText('Preferences saved');
  await expect(page.getByLabel('Your timezone')).toHaveValue('Europe/Lisbon');
  await expect(page.getByLabel('Day boundary for due queues')).toHaveValue(
    '05:30'
  );
});

test('practice answers produce immediate feedback and results counts', async ({
  page
}) => {
  await page.goto('/prototype/practice');
  await page.getByRole('radio', { name: 'est' }).check();
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.locator('.feedback')).toContainText('Correct');
  await page.getByRole('button', { name: 'Next item' }).click();
  await page.getByRole('button', { name: 'Not sure' }).click();
  await expect(page.locator('.feedback')).toContainText('Uncertain');
});

test('deck draft approval updates the pending queue', async ({ page }) => {
  await page.goto('/prototype/decks');
  const pending = page.getByRole('heading', { name: /pending approval/iu });
  await expect(pending).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).first().click();
  await expect(page.getByRole('status')).toContainText('approved');
});

test('deck actions reject drafts, suspend approved cards, and generate an export', async ({
  page
}) => {
  await page.goto('/prototype/decks');
  const draft = page.locator('ul.drafts li', { hasText: 'tu es vs tu as' });
  await draft.getByRole('button', { name: 'Reject' }).click();
  await expect(page.getByRole('status')).toContainText('rejected');

  const approved = page.locator('tr', { hasText: 'Est-ce que' }).first();
  const suspended = approved.getByRole('checkbox');
  await suspended.check();
  await expect(approved).toContainText('Yes');
  await suspended.uncheck();
  await expect(approved).toContainText('No');
  await expect(page.getByRole('status')).toContainText('resumed');

  await page.getByRole('button', { name: 'Export to Anki…' }).first().click();
  await expect(
    page.getByRole('group', { name: 'Export French mistakes to Anki' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Export to Anki…' }).first().click();
  await page.getByRole('button', { name: 'Generate package' }).click();
  await expect(
    page
      .getByRole('group', { name: 'Export French mistakes to Anki' })
      .getByRole('status')
  ).toContainText('Package ready');

  while ((await page.locator('ul.drafts li').count()) > 0) {
    await page.getByRole('button', { name: 'Approve' }).first().click();
  }
  await expect(page.getByText(/no drafts waiting/i)).toBeVisible();
});

test('lesson links reflect a requested skill only when it exists', async ({
  page
}) => {
  await page.goto('/prototype/lesson?skill=fr-a1-004');
  await expect(
    page.getByText('Requested skill:', { exact: false })
  ).toContainText('fr-a1-004');
  await page.goto('/prototype/lesson?skill=missing-skill');
  await expect(page.getByText('Requested skill:')).toHaveCount(0);
});

test('results derives missed items from the answers actually given', async ({
  page
}) => {
  await completePractice(page, TWO_MISS_RESPONSES);
  const missed = page.locator('.missed');
  await expect(missed).toHaveCount(2);
  await expect(missed.nth(0)).toContainText('fatiguée');
  await expect(missed.nth(0)).toContainText('Your answer: es');
  await expect(missed.nth(1)).toContainText('Your answer: je mange');
});

test('results shows no mistakes when every answer was correct', async ({
  page
}) => {
  await completePractice(page, [
    'est',
    'allons',
    'je vais manger',
    'je vais au marché'
  ]);
  await expect(page.locator('.missed')).toHaveCount(0);
  await expect(page.getByText('No mistakes this session')).toBeVisible();
});

test('a kept mistake stays kept after leaving and returning to results', async ({
  page
}) => {
  await completePractice(page, TWO_MISS_RESPONSES);
  const firstMissed = page.locator('.missed').first();
  await firstMissed.getByRole('button', { name: 'Keep as flashcard' }).click();
  await expect(page.getByRole('status')).toContainText('Draft card created');
  const keptDraft = page.getByText('« Elle ___ fatiguée » — est, not es', {
    exact: true
  });
  await goToDrafts(page);
  await expect(keptDraft).toHaveCount(1);
  await page.goBack();
  await expect(
    firstMissed.getByRole('button', { name: 'Keep as flashcard' })
  ).toHaveCount(0);
  await expect(firstMissed).toContainText('Added to drafts');
  // Revisiting must not re-announce a creation that did not happen here.
  await expect(page.getByText('Draft card created')).toHaveCount(0);
  await expect(page.getByText('Kept mistakes stay drafts')).toBeVisible();
  // Leave and return once more — the keep must stay a no-op, not duplicate.
  await draftsRoundTrip(page);
  await expect(firstMissed).toContainText('Added to drafts');
  await goToDrafts(page);
  await expect(keptDraft).toHaveCount(1);
});

test('an approved kept mistake shows its terminal state, not draft copy', async ({
  page
}) => {
  await page.goto('/prototype/results');
  await page.getByRole('button', { name: 'Keep as flashcard' }).click();
  await goToDrafts(page);
  await page
    .locator('ul.drafts li', { hasText: '« Elle ___ fatiguée » — est, not es' })
    .getByRole('button', { name: 'Approve' })
    .click();
  await page.goBack();
  const missed = page.locator('.missed').first();
  await expect(missed).toContainText('Approved as a flashcard.');
  await expect(missed).not.toContainText('Added to drafts');
  await expect(
    missed.getByRole('button', { name: 'Keep as flashcard' })
  ).toHaveCount(0);
});

test('results totals follow the session when the count params are stripped', async ({
  page
}) => {
  await completePractice(page, TWO_MISS_RESPONSES);
  // The screen-state switcher flips to the error view in-session…
  await page
    .getByRole('navigation', { name: 'Prototype screen states' })
    .getByRole('link', { name: 'error' })
    .click();
  // …and Retry lands on a bare results URL while answers stay recorded.
  await page.getByRole('link', { name: 'Retry' }).click();
  await expect(page.locator('.totals dd')).toHaveText(['2', '2', '0']);
  await expect(page.locator('.missed')).toHaveCount(2);
});

test('a re-entered practice run replaces the recorded answers', async ({
  page
}) => {
  await completePractice(page, TWO_MISS_RESPONSES);
  // Leave results via real links and re-enter practice mid-session; the new
  // run must replace the recorded answers rather than merge with them.
  await page.getByRole('link', { name: 'Back to the map' }).click();
  await page.locator('a.skill-link').first().click();
  await page.getByRole('link', { name: 'Practice this skill' }).click();
  await answerPracticeItems(page, ALL_CORRECT_RESPONSES);
  await expect(page.locator('.totals dd')).toHaveText(['4', '0', '0']);
  await expect(page.locator('.missed')).toHaveCount(0);
  await expect(
    page.getByText('No mistakes this session — nothing to keep.')
  ).toBeVisible();
});

test('kept mistake becomes an approvable draft in decks', async ({ page }) => {
  await page.goto('/prototype/results');
  await page.getByRole('button', { name: 'Keep as flashcard' }).click();
  await page.getByRole('link', { name: 'See card drafts' }).click();
  await expect(
    page.getByText('« Elle ___ fatiguée » — est, not es', { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).last().click();
  await expect(page.getByRole('status')).toContainText('approved');
});

test('anki export preference hides the deck export action', async ({
  page
}) => {
  await page.goto('/prototype/settings');
  await page.getByRole('checkbox', { name: /export to anki/iu }).uncheck();
  await page.getByRole('link', { name: 'Decks', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /export to anki/iu })
  ).toHaveCount(0);
});

test('prototype error and forbidden states render safe messages', async ({
  page
}) => {
  await page.goto('/prototype?state=error');
  await expect(page.getByRole('alert')).toBeVisible();
  await page.goto('/prototype/map?track=de-a2');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Not enrolled');
  await page.goto('/prototype/review?state=empty');
  await expect(
    page.getByRole('heading', { name: /all caught up/iu })
  ).toBeVisible();
});

test('prototype screens have no horizontal overflow', async ({ page }) => {
  for (const path of prototypePages) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth -
        globalThis.document.documentElement.clientWidth
    );
    expect(overflow, `${path} has horizontal overflow`).toBeLessThanOrEqual(1);
  }
});
