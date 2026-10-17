import { beforeEach, describe, expect, it, vi } from 'vitest';

const { cleanCache, generate, cleanupBrowserEnvironment } = vi.hoisted(() => ({
  cleanCache: vi.fn(),
  generate: vi.fn(),
  cleanupBrowserEnvironment: vi.fn()
}));

vi.mock('monocart-coverage-reports', () => ({
  CoverageReport: class {
    cleanCache = cleanCache;
    generate = generate;
  }
}));

vi.mock('../scripts/playwright-environment.mjs', () => ({
  default: vi.fn(async () => cleanupBrowserEnvironment)
}));

import setup from '../scripts/playwright-coverage-setup.mjs';

describe('Playwright coverage global setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears old Monocart data before tests and generates the configured report at teardown', async () => {
    const teardown = await setup({} as never);

    expect(cleanCache).toHaveBeenCalledOnce();
    expect(generate).not.toHaveBeenCalled();

    await teardown();

    expect(generate).toHaveBeenCalledOnce();
    expect(cleanupBrowserEnvironment).toHaveBeenCalledOnce();
  });

  it('cleans up the browser environment even when report generation fails', async () => {
    generate.mockRejectedValueOnce(new Error('synthetic report failure'));
    const teardown = await setup({} as never);

    await expect(teardown()).rejects.toThrow('synthetic report failure');

    expect(cleanupBrowserEnvironment).toHaveBeenCalledOnce();
  });
});
