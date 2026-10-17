import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const clientRoot = resolve('build/client');

export default {
  name: 'Langlo Playwright source coverage',
  outputDir: '.ci-reports/playwright-coverage',
  reports: ['v8', 'json-summary', 'lcov', 'console-details'],
  entryFilter: /** @param {{url: string}} entry */ (entry) => {
    const url = new URL(entry.url);
    if (
      !url.pathname.includes('/_app/immutable/') ||
      !url.pathname.endsWith('.js')
    ) {
      return false;
    }
    const mapPath = resolve(clientRoot, `.${url.pathname}.map`);
    if (!mapPath.startsWith(clientRoot + sep)) {
      throw new Error(`Source map path escapes ${clientRoot}: ${mapPath}`);
    }
    if (!existsSync(mapPath)) return false;
    /** @type {{sources: string[]}} */
    const { sources } = JSON.parse(readFileSync(mapPath, 'utf8'));
    return sources.some((source) =>
      /(?:^|\/)src\//u.test(source.replaceAll('\\', '/'))
    );
  },
  sourceFilter: /** @param {string} sourcePath */ (sourcePath) => {
    const normalized = sourcePath.replaceAll('\\', '/');
    return (
      !normalized.startsWith('node_modules/') &&
      !normalized.includes('/node_modules/') &&
      /(?:^|\/)src\//u.test(normalized)
    );
  }
};
