import { CoverageReport } from 'monocart-coverage-reports';
import coverageOptions from './monocart-coverage.config.mjs';
import setupBrowserEnvironment from './playwright-environment.mjs';

export default async function setup(config) {
  const cleanupBrowserEnvironment = await setupBrowserEnvironment(config);
  const coverage = new CoverageReport(coverageOptions);
  await coverage.cleanCache();

  return async () => {
    try {
      await coverage.generate();
    } finally {
      cleanupBrowserEnvironment?.();
    }
  };
}
