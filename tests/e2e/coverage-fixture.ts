import {
  test as base,
  type Browser,
  type BrowserContext,
  type Page
} from '@playwright/test';
import { CoverageReport } from 'monocart-coverage-reports';
import coverageOptions from '../../scripts/monocart-coverage.config.mjs';

type CoverageEntries = Awaited<ReturnType<Page['coverage']['stopJSCoverage']>>;

export const test = base.extend<{ monocartCoverage: void }>({
  monocartCoverage: [
    async ({ browser, context }, use) => {
      if (browser.browserType().name() !== 'chromium') {
        await use();
        return;
      }

      const collected: Array<Promise<CoverageEntries>> = [];
      const stops = new Map<Page, () => Promise<void>>();
      const starts = new Map<Page, Promise<void>>();
      const restores: Array<() => void> = [];

      // Coverage can only be stopped while a page is open, so it is collected
      // right before any close and kept, instead of read back at teardown.
      const trackPage = (page: Page) => {
        if (stops.has(page)) return;
        const started = page.coverage.startJSCoverage({
          resetOnNavigation: false
        });
        starts.set(page, started);
        let stopped: Promise<void> | undefined;
        const stop = () => {
          stopped ??= started.then(async () => {
            if (page.isClosed()) return;
            const entries = page.coverage.stopJSCoverage();
            collected.push(entries);
            await entries;
          });
          return stopped;
        };
        stops.set(page, stop);
        const close = page.close.bind(page);
        page.close = async (options) => {
          await stop();
          return close(options);
        };
        restores.push(() => void (page.close = close));
      };

      const trackContext = (target: BrowserContext) => {
        target.on('page', trackPage);
        for (const page of target.pages()) trackPage(page);
        // A page must not be handed to the test before coverage is running,
        // or its first navigation can execute scripts that go unrecorded.
        const newPage = target.newPage.bind(target);
        target.newPage = async () => {
          const page = await newPage();
          trackPage(page);
          await starts.get(page);
          return page;
        };
        restores.push(() => void (target.newPage = newPage));
        const close = target.close.bind(target);
        target.close = async (options) => {
          await Promise.all([...stops.values()].map((stop) => stop()));
          return close(options);
        };
        restores.push(() => void (target.close = close));
      };

      const wrapBrowser = (target: Browser) => {
        const newContext = target.newContext.bind(target);
        target.newContext = async (options) => {
          const created = await newContext(options);
          trackContext(created);
          return created;
        };
        restores.push(() => void (target.newContext = newContext));
      };

      wrapBrowser(browser);
      trackContext(context);
      await Promise.all(starts.values());

      try {
        await use();
      } finally {
        await Promise.all([...stops.values()].map((stop) => stop()));
        restores.forEach((restore) => restore());
        const data = await Promise.all(collected);
        if (data.length) {
          await new CoverageReport(coverageOptions).add(data.flat());
        }
      }
    },
    { auto: true, scope: 'test' }
  ]
});
