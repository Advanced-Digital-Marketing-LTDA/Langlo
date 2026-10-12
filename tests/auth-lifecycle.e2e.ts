import { readdir, readFile, watch } from 'node:fs/promises';
import { join } from 'node:path';
import { test, type Browser } from '@e2e-dev/web';
import { credentials, expect, type Agent, type App, type Screen } from 'e2e';
import { mailCaptureDirectory } from './fixtures/e2e-auth-mail.ts';

type AuthUi = { app: App; agent: Agent; browser: Browser; screen: Screen };
type Learner = ReturnType<typeof credentials.user>;

async function mailFiles(): Promise<string[]> {
  return (await readdir(mailCaptureDirectory)).filter((name) =>
    name.endsWith('.json')
  );
}

async function capturedMailFile(): Promise<string> {
  const watcher = watch(mailCaptureDirectory, {
    signal: AbortSignal.timeout(5000)
  });
  try {
    while (true) {
      const [file] = await mailFiles();
      if (file) return file;
      await watcher.next();
    }
  } finally {
    await watcher.return?.();
  }
}

async function capturedResetMail(): Promise<{ to: string; text: string }> {
  return JSON.parse(
    await readFile(join(mailCaptureDirectory, await capturedMailFile()), 'utf8')
  ) as {
    to: string;
    text: string;
  };
}

async function signIn(ui: AuthUi, learner: Learner): Promise<void> {
  await ui.app.open('/login');
  await expect(ui.screen.getByRole('heading', 'Sign in')).toBeVisible();
  await expect(ui.browser.locator('body')).toContainText(
    'Accounts are provisioned by the operator.'
  );
  await expect(ui.screen.getByRole('link', 'Sign up')).not.toBeVisible();
  await ui.agent.act('Sign in with the provided learner credentials.', {
    params: { username: learner.username, password: learner.password }
  });
  await expect(ui.browser).toHaveURL('/app');
  await expect(ui.browser.locator('body')).toContainText('E2E Learner');
}

async function signOut(ui: Pick<AuthUi, 'browser' | 'screen'>): Promise<void> {
  await ui.screen.getByRole('button', 'Sign out').click();
  await expect(ui.browser).toHaveURL('/login');
}

async function requestRecovery(
  ui: Pick<AuthUi, 'app' | 'agent' | 'screen'>,
  email: string
): Promise<void> {
  await ui.app.open('/recover');
  await ui.agent.act(
    'Request a password reset for the provided learner email.',
    {
      params: { email }
    }
  );
  await expect(ui.screen.getByRole('status')).toContainText(
    'If this email exists in our system, check your email for the reset link.'
  );
}

test('private learner can sign in, sign out, and request account recovery', async ({
  app,
  agent,
  browser,
  screen
}) => {
  const learner = credentials.user('learner');
  await signIn({ app, agent, browser, screen }, learner);
  await signOut({ browser, screen });
  await requestRecovery({ app, agent, screen }, learner.username);
  const message = await capturedResetMail();
  expect(message.to).toBe(learner.username);
  expect(message.text).toMatch(/\/api\/auth\/reset-password\//u);
});
