import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const cacheVariable = 'LANGLO_PLAYWRIGHT_FONT_CACHE';
/** @type {Set<() => void>} */
const cleanups = new Set();

/** Keep the runner's cache paths unchanged; workers inherit only the run's cache identity.
 * @param {string} platform
 * @param {NodeJS.ProcessEnv} env
 * @returns {{env: NodeJS.ProcessEnv, cleanup: () => void}}
 */
export function prepareBrowserEnvironment(
  platform = process.platform,
  env = process.env
) {
  if (platform !== 'linux') return { env: { ...env }, cleanup() {} };
  const inherited = env[cacheVariable];
  const cache =
    inherited || mkdtempSync(join(tmpdir(), 'langlo-playwright-fonts-'));
  if (!inherited) env[cacheVariable] = cache;
  const cleanup = () => {
    // Only the process that allocated this directory may remove it.
    if (inherited) return;
    rmSync(cache, { recursive: true, force: true });
    if (env[cacheVariable] === cache) delete env[cacheVariable];
    cleanups.delete(cleanup);
    process.removeListener('exit', cleanup);
  };
  if (!inherited) {
    cleanups.add(cleanup);
    // Also cover --list and failures before the setup hook runs.
    process.once('exit', cleanup);
  }
  return { env: { ...env, XDG_CACHE_HOME: cache }, cleanup };
}

/** @param {{width: number, height: number} | null} box */
export function assertRenderedText(box) {
  if (!(box && box.width > 0 && box.height > 0))
    throw new Error(
      'Browser text has no visible dimensions. Check installed fonts and Fontconfig configuration.'
    );
}

function cleanupCaches() {
  for (const cleanup of [...cleanups]) cleanup();
}

/** @param {import('@playwright/test').FullConfig} config */
export default async function setup(config) {
  try {
    const browser = await chromium.launch({
      timeout: 10000,
      ...config.projects[0].use.launchOptions
    });
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(10000);
      await page.setContent('<h1>Langlo browser preflight</h1>');
      assertRenderedText(await page.locator('h1').boundingBox());
    } finally {
      await browser.close();
    }
  } catch (error) {
    cleanupCaches();
    throw new Error(
      'Playwright browser preflight failed. Check Chromium system dependencies, installed fonts and Fontconfig; use npx playwright install --with-deps chromium to install browser dependencies.',
      { cause: error }
    );
  }
  console.log('Playwright browser preflight passed.');
  return cleanupCaches;
}
