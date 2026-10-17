import { defineConfig, devices } from '@playwright/test';
import { prepareBrowserEnvironment } from './scripts/playwright-environment.mjs';

const browserEnvironment = prepareBrowserEnvironment();

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './scripts/playwright-coverage-setup.mjs',
  reporter: [
    ['list'],
    [
      'monocart-reporter',
      {
        name: 'Langlo Playwright E2E',
        outputFile: '.ci-reports/playwright-test-report.html'
      }
    ]
  ],
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 20000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    launchOptions: {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? {
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
            args: ['--no-sandbox']
          }
        : {}),
      env: browserEnvironment.env
    }
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium' }
    }
  ],
  webServer: {
    command: 'node build',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: false,
    env: {
      HOST: '127.0.0.1',
      PORT: '4173',
      APP_ENV: 'test',
      APP_ORIGIN: 'http://127.0.0.1:4173'
    },
    timeout: 15000
  }
});
