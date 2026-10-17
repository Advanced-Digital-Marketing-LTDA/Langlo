import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const clientRoot = resolve('build/client');

/** @param {string} pathname */
function clientSourceMapPath(pathname) {
  const mapPath = resolve(clientRoot, `.${pathname}`);
  if (!mapPath.startsWith(clientRoot + sep)) {
    throw new Error(`Source map path escapes ${clientRoot}: ${mapPath}`);
  }
  if (!existsSync(mapPath)) return undefined;
  const realClientRoot = realpathSync(clientRoot);
  const realMapPath = realpathSync(mapPath);
  if (!realMapPath.startsWith(realClientRoot + sep)) {
    throw new Error(`Source map path escapes ${clientRoot}: ${realMapPath}`);
  }
  return realMapPath;
}

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
    const mapPath = clientSourceMapPath(`${url.pathname}.map`);
    if (!mapPath) return false;
    /** @type {{sources: string[], mappings?: string}} */
    const { sources, mappings } = JSON.parse(readFileSync(mapPath, 'utf8'));
    return (
      typeof mappings === 'string' &&
      mappings.length > 0 &&
      sources.some((source) =>
        /(?:^|\/)src\//u.test(source.replaceAll('\\', '/'))
      )
    );
  },
  /** @param {string} mapUrl @param {Function} _defaultResolver */
  sourceMapResolver: async (mapUrl, _defaultResolver) => {
    const mapPath = clientSourceMapPath(new URL(mapUrl).pathname);
    return mapPath ? JSON.parse(readFileSync(mapPath, 'utf8')) : undefined;
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
