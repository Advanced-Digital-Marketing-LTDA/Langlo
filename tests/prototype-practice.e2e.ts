import { test, type Browser } from '@e2e-dev/web';
import { expect, type Agent, type Screen } from 'e2e';

async function completeAnswers(screen: Screen): Promise<void> {
  const answers = ['est', 'allons', 'je vais manger', 'je vais au marché'];
  for (const [index, answer] of answers.entries()) {
    if (index === 0) await screen.getByRole('radio', answer).check();
    else await screen.getByRole('textbox', 'Your answer').fill(answer);
    await screen.getByRole('button', 'Submit answer').click();
    if (index < answers.length - 1)
      await screen.getByRole('button', 'Next item').click();
    else await screen.getByRole('link', 'See results').click();
  }
}

async function openRecommendedLesson(
  agent: Agent,
  screen: Screen,
  browser: Browser
): Promise<void> {
  await agent.act('Open the curriculum map.');
  await screen
    .getByRole('link', 'Use subject pronouns with common verbs')
    .click();
  await expect(browser).toHaveURL(/\/prototype\/lesson\?skill=fr-a1-002$/u);
  await expect(
    screen.getByText(
      /Requested skill: Use subject pronouns with common verbs \(fr-a1-002\)/u
    )
  ).toBeVisible();
  await expect(screen.getByRole('link', 'Practice this skill')).toBeVisible();
}

async function verifyResults(browser: Browser): Promise<void> {
  await expect(browser).toHaveURL(/\/prototype\/results(?:\?.*)?$/u);
  await expect(browser.locator('h1')).toContainText('Session results');
  await expect(browser.locator('.total dd')).toHaveText(['4', '0', '0']);
  await expect(browser.locator('body')).toContainText(
    'No mistakes this session'
  );
}

test('learner completes a practice session and reviews results', async ({
  app,
  agent,
  screen,
  browser
}) => {
  await app.open('/prototype');
  await openRecommendedLesson(agent, screen, browser);
  await agent.act('Open Practice this skill.');
  await expect(browser).toHaveURL(/\/prototype\/practice(?:\?.*)?$/u);
  await completeAnswers(screen);
  await verifyResults(browser);
});
