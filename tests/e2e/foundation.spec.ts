import { expect, test } from '@playwright/test';

test('public shell works with keyboard navigation and browser history', async ({
  page
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Language Grammar Coach' })
  ).toBeVisible();
  await page.getByRole('link', { name: 'Help' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/help$/);
  await expect(
    page.getByRole('heading', { name: 'Getting started' })
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/help$/);
});

test('private routes deny access before accounts are implemented', async ({
  request
}) => {
  const response = await request.get('/app/cards', { maxRedirects: 0 });
  expect(response.status()).toBe(303);
  expect(response.headers().location).toBe('/login');
  expect(response.headers()['cache-control']).toBe('private, no-store');
  expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow');
  const posted = await request.post('/app/cards', {
    data: { ownerId: 'someone-else', answer: 'private-answer' },
    maxRedirects: 0
  });
  expect(posted.status()).toBe(503);
  expect(await posted.text()).not.toContain('private-answer');
});

test('server generates correlation ids and exposes honest readiness', async ({
  request
}) => {
  const first = await request.get('/health/live', {
    headers: { 'x-correlation-id': 'untrusted-secret' }
  });
  const second = await request.get('/health/live');
  expect(first.status()).toBe(200);
  expect(await first.json()).toEqual({ status: 'live' });
  expect(first.headers()['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  expect(first.headers()['x-correlation-id']).not.toBe(
    second.headers()['x-correlation-id']
  );
  const ready = await request.get('/health/ready');
  expect(ready.status()).toBe(503);
  expect(await ready.json()).toEqual({
    status: 'not-ready',
    reason: 'foundation-in-progress'
  });
});

test('missing page excludes tokens, submitted text and stack details', async ({
  page,
  request
}) => {
  await page.goto('/missing?token=sentinel-secret&answer=private-answer');
  await expect(
    page.getByRole('heading', { name: 'Page unavailable' })
  ).toBeVisible();
  await expect(page.locator('body')).not.toContainText('sentinel-secret');
  await expect(page.locator('body')).not.toContainText('private-answer');
  const response = await request.get('/build.json');
  expect(await response.json()).toEqual({
    revision: 'unknown',
    stage: 'local-foundation'
  });
});

test('phone and desktop shell have no horizontal overflow', async ({
  page
}) => {
  await page.goto('/');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath('foundation.png'),
    fullPage: true
  });
});
