import { expect } from '@playwright/test';
import { CoverageReport } from 'monocart-coverage-reports';
import { test } from './coverage-fixture';

const addedCoverage: unknown[][] = [];
const originalAdd = CoverageReport.prototype.add;
CoverageReport.prototype.add = async function (entries) {
  if (Array.isArray(entries)) addedCoverage.push(entries);
  return originalAdd.call(this, entries);
};

test.afterAll(() => {
  const entries = addedCoverage.flat() as Array<{ url?: string }>;
  expect(entries.some(({ url }) => url?.includes('/_app/immutable/'))).toBe(
    true
  );
});

test('the automatic Chromium fixture captures JavaScript and CSS from new pages and contexts', async ({
  browser,
  page
}) => {
  const captured = { javascript: 0, css: 0 };

  const observeCoverageOnClose = (target: typeof page) => {
    const stopJavaScript = target.coverage.stopJSCoverage.bind(target.coverage);
    const stopCss = target.coverage.stopCSSCoverage.bind(target.coverage);
    target.coverage.stopJSCoverage = async () => {
      const entries = await stopJavaScript();
      captured.javascript += entries.length;
      return entries;
    };
    target.coverage.stopCSSCoverage = async () => {
      const entries = await stopCss();
      captured.css += entries.length;
      return entries;
    };
  };

  const contextPage = await page.context().newPage();
  observeCoverageOnClose(contextPage);
  await contextPage.goto('/prototype');
  await contextPage.close();

  const separateContext = await browser.newContext();
  const separatePage = await separateContext.newPage();
  observeCoverageOnClose(separatePage);
  await separatePage.goto('/prototype');
  await separateContext.close();

  expect(captured.javascript).toBeGreaterThan(0);
  expect(captured.css).toBeGreaterThan(0);
});
