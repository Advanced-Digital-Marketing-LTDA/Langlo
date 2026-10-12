import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 20000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
          args: ['--no-sandbox']
        }
      : {}
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
