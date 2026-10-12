import { test } from '@e2e-dev/web';
import { credentials, expect } from 'e2e';

test('private learner can sign in, sign out, and request account recovery', async ({
  app,
  agent,
  browser,
  screen
}) => {
  const learner = credentials.user('learner');
  await app.open('/login');
  await expect(screen.getByRole('heading', 'Sign in')).toBeVisible();
  await expect(browser.locator('body')).toContainText(
    'Accounts are provisioned by the operator.'
  );
  await expect(screen.getByRole('link', 'Sign up')).not.toBeVisible();
  await agent.act(
    'Enter the provided learner credentials and leave the form ready to submit.',
    {
      params: { username: learner.username, password: learner.password }
    }
  );
  // The e2e proxy omits Origin on form POSTs; keep the app CSRF check intact
  // and submit through Better Auth's JSON endpoint in this browser context.
  const signInStatus = await browser.evaluate(async () => {
    // eslint-disable-next-line no-restricted-globals -- This callback runs in the browser page.
    const form = globalThis['document'].querySelector('form');
    if (!form) return 0;
    const data = new FormData(form);
    const response = await fetch('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: data.get('email'),
        password: data.get('password')
      })
    });
    return response.status;
  });
  expect(signInStatus).toBe(200);
  expect((await browser.cookies()).map(({ name }) => name)).toContain(
    'better-auth.session_token'
  );
  await app.open('/app');
  await expect(browser).toHaveURL('/app');
  await expect(browser.locator('body')).toContainText('E2E Learner');

  const signOutStatus = await browser.evaluate(async () => {
    const response = await fetch('/api/auth/sign-out', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    return response.status;
  });
  expect(signOutStatus).toBe(200);
  await app.open('/app');
  await expect(browser).toHaveURL('/login');

  await app.open('/recover');
  await agent.act('Enter the provided learner email in the recovery form.', {
    params: { email: learner.username }
  });
  const recoveryStatus = await browser.evaluate(async () => {
    // eslint-disable-next-line no-restricted-globals -- This callback runs in the browser page.
    const form = globalThis['document'].querySelector('form');
    if (!form) return 0;
    const data = new FormData(form);
    const response = await fetch('/api/auth/request-password-reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: data.get('email'), redirectTo: '/reset' })
    });
    return response.status;
  });
  expect(recoveryStatus).toBe(200);
});
