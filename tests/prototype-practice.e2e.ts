import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('learner completes a practice session and reviews results', async ({
  app,
  agent,
  screen,
  browser
}) => {
  await app.open('/prototype');
  await agent.act('Open the recommended French A1 lesson.');
  await expect(browser).toHaveURL(/\/prototype\/lesson(?:\?.*)?$/);
  await expect(screen.getByRole('link', 'Practice this skill')).toBeVisible();

  await agent.act('Open Practice this skill.');
  await expect(browser).toHaveURL(/\/prototype\/practice(?:\?.*)?$/);

  const answers = ['est', 'allons', 'je vais manger', 'je vais au marché'];
  for (const [index, answer] of answers.entries()) {
    if (index === 0) {
      await screen.getByRole('radio', answer).check();
    } else {
      await screen.getByRole('textbox', 'Your answer').fill(answer);
    }
    await screen.getByRole('button', 'Submit answer').click();
    if (index < answers.length - 1) {
      await screen.getByRole('button', 'Next item').click();
    } else {
      await screen.getByRole('link', 'See results').click();
    }
  }

  await expect(browser).toHaveURL(/\/prototype\/results(?:\?.*)?$/);
  await expect(browser.locator('h1')).toContainText('Session results');
  await expect(browser.locator('.total dd')).toHaveText(['4', '0', '0']);
  await expect(browser.locator('body')).toContainText(
    'No mistakes this session'
  );
});
