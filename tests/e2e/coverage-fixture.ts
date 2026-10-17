import { test as base, type Page } from '@playwright/test';
import { CoverageReport } from 'monocart-coverage-reports';
import coverageOptions from '../../scripts/monocart-coverage.config.mjs';

export const test = base.extend<{ monocartCoverage: void }>({
  monocartCoverage: [
    async ({ context }, use) => {
      const isChromium = context.browser()?.browserType().name() === 'chromium';
      const starts = new Map<Page, Promise<void>>();
      const startCoverage = (page: Page) => {
        if (!isChromium || starts.has(page)) return;
        starts.set(
          page,
          Promise.all([
            page.coverage.startJSCoverage({ resetOnNavigation: false }),
            page.coverage.startCSSCoverage({ resetOnNavigation: false })
          ]).then(() => undefined)
        );
      };

      context.on('page', startCoverage);
      for (const page of context.pages()) startCoverage(page);

      try {
        await use();
      } finally {
        context.off('page', startCoverage);
        await Promise.all(starts.values());
        const data = await Promise.all(
          [...starts.keys()]
            .filter((page) => !page.isClosed())
            .map(async (page) => {
              const [js, css] = await Promise.all([
                page.coverage.stopJSCoverage(),
                page.coverage.stopCSSCoverage()
              ]);
              return [...js, ...css];
            })
        );
        if (data.length) {
          await new CoverageReport(coverageOptions).add(data.flat());
        }
      }
    },
    { auto: true, scope: 'test' }
  ]
});
