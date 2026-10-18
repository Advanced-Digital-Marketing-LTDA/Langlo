import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const metrics = ['lines', 'statements', 'functions', 'branches'];
export const excludedTelemetry = ['src/lib/glitchtip/'];

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * @param {Record<string, unknown>} input
 * @param {string} sourcePath
 * @param {string} name
 */
function readMetric(input, sourcePath, name) {
  const source = input[sourcePath];
  if (!Object.hasOwn(input, sourcePath) || !isRecord(source)) {
    throw new Error('Invalid source coverage object: ' + sourcePath);
  }
  const value = source[name];
  if (!Object.hasOwn(source, name) || !isRecord(value)) {
    throw new Error('Invalid ' + name + ' coverage for ' + sourcePath);
  }
  const { covered, total } = value;
  if (
    typeof covered !== 'number' ||
    typeof total !== 'number' ||
    !Number.isSafeInteger(covered) ||
    !Number.isSafeInteger(total) ||
    covered < 0 ||
    total < 0 ||
    covered > total
  ) {
    throw new Error('Invalid ' + name + ' coverage for ' + sourcePath);
  }
  return { covered, total };
}

/** @param {Record<string, unknown>} input @param {string[]} paths */
function rollup(input, paths) {
  return Object.fromEntries(
    metrics.map((name) => {
      const { covered, total } = paths.reduce(
        (sum, path) => {
          const value = readMetric(input, path, name);
          sum.covered += value.covered;
          sum.total += value.total;
          return sum;
        },
        { covered: 0, total: 0 }
      );
      if (total === 0) {
        throw new Error('Empty ' + name + ' coverage denominator');
      }
      return [
        name,
        { covered, total, percent: Number(((covered / total) * 100).toFixed(2)) }
      ];
    })
  );
}

/** @param {unknown} input @param {string[]} requiredMappedSources */
export function summarizeCoverage(input, requiredMappedSources) {
  if (!isRecord(input) || !Object.hasOwn(input, 'total')) {
    throw new Error('Missing Monocart total');
  }
  for (const name of metrics) readMetric(input, 'total', name);

  if (
    !Array.isArray(requiredMappedSources) ||
    requiredMappedSources.length === 0 ||
    requiredMappedSources.some(
      (path) => typeof path !== 'string' || !path.startsWith('src/')
    ) ||
    new Set(requiredMappedSources).size !== requiredMappedSources.length
  ) {
    throw new Error('Invalid required mapped-source inventory');
  }

  const keys = Object.keys(input)
    .filter((key) => key.startsWith('src/'))
    .sort();
  if (!keys.length) {
    throw new Error('Missing mapped original src/ files');
  }

  const present = new Set(keys);
  const missing = requiredMappedSources.filter((path) => !present.has(path));
  if (missing.length) {
    throw new Error('Missing baseline mapped source: ' + missing.join(', '));
  }

  const excluded = keys.filter((path) =>
    excludedTelemetry.some((prefix) => path.startsWith(prefix))
  );
  const included = keys.filter((path) => !excluded.includes(path));
  if (!included.length) {
    throw new Error('No product source files to measure');
  }

  const expected = new Set(requiredMappedSources);
  const newMappedSources = keys.filter((path) => !expected.has(path));
  const bundledEntries = Object.keys(input)
    .filter((key) => key !== 'total' && !key.startsWith('src/'))
    .sort();

  return {
    schema_version: 1,
    scope: 'observed-source-only-not-whole-repository',
    caveat:
      'Only mapped original src/ entries emitted by Monocart are measured. Files never observed by V8 are absent from the denominator; this is NOT a full-application coverage gate.',
    policy:
      'Exclude only GlitchTip logging integration from product metrics. Preserve all raw data and test execution.',
    product: { metrics: rollup(input, included), files: included },
    unfiltered_original_source: { metrics: rollup(input, keys), files: keys },
    exclusions: excluded.map((path) => ({
      path,
      reason: 'GlitchTip logging integration; separately covered by unit tests'
    })),
    diagnostics: {
      compiled_or_unmapped_entries: bundledEntries,
      new_mapped_sources: newMappedSources,
      warning:
        'Raw Monocart totals include generated bundles; observed-source metrics exclude those bundles, but do not account for source files V8 never mapped.'
    }
  };
}

/** @param {unknown} value */
const escapeHtml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/** @param {string} title @param {{ metrics: ReturnType<typeof rollup> }} section */
function metricTable(title, section) {
  const rows = metrics
    .map((name) => {
      const value = section.metrics[name];
      if (!value) throw new Error('Missing report metric ' + name);
      const cells = [
        name,
        value.covered,
        value.total,
        value.percent === null ? 'n/a' : String(value.percent) + '%'
      ];
      return '<tr>' +
        cells.map((cell) => '<td>' + escapeHtml(cell) + '</td>').join('') +
        '</tr>';
    })
    .join('');
  return '<h2>' + escapeHtml(title) +
    '</h2><table><thead><tr><th>Metric</th><th>Covered</th><th>Total</th><th>Percent</th></tr></thead><tbody>' +
    rows + '</tbody></table>';
}

/** @param {ReturnType<typeof summarizeCoverage>} report */
export function renderHtml(report) {
  const excluded = report.exclusions
    .map(
      ({ path, reason }) =>
        '<li><code>' + escapeHtml(path) + '</code> — ' +
        escapeHtml(reason) + '</li>'
    )
    .join('');
  const newSources = report.diagnostics.new_mapped_sources
    .map((path) => '<li><code>' + escapeHtml(path) + '</code></li>')
    .join('');
  const parts = [
    '<!doctype html><html lang="en"><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Langlo observed-source E2E coverage</title>',
    '<style>body{font:16px/1.5 system-ui;max-width:900px;margin:32px auto;padding:0 16px}table{border-collapse:collapse;width:100%}td,th{text-align:left;border-bottom:1px solid #aaa;padding:7px}code{overflow-wrap:anywhere}</style>',
    '</head><body><h1>Langlo E2E source coverage</h1>',
    '<p><strong>Observed-source diagnostic, not full application coverage.</strong> ' +
      escapeHtml(report.caveat) + '</p>',
    metricTable('Product source (GlitchTip excluded)', report.product),
    metricTable('Unfiltered original source', report.unfiltered_original_source),
    '<h2>Excluded telemetry</h2><ul>' + excluded + '</ul>',
    '<h2>Attribution warnings</h2><p>' +
      escapeHtml(report.diagnostics.warning) + '</p>',
    '<p>Generated/unmapped entries: ' +
      escapeHtml(report.diagnostics.compiled_or_unmapped_entries.length) + '</p>',
    '<h2>New mapped sources not in baseline</h2><ul>' + newSources + '</ul>',
    '</body></html>'
  ];
  return parts.join('\n') + '\n';
}

/** @param {string} path */
function assertNoSymlink(path) {
  if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error('Refusing symlinked coverage report path: ' + path);
  }
}

/** @param {string} rootDir */
export function generateReport(rootDir = process.cwd()) {
  // Paths are fixed beneath the working directory. The CLI accepts no paths.
  const root = realpathSync(rootDir);
  const directory = join(root, '.ci-reports', 'playwright-coverage');
  assertNoSymlink(join(root, '.ci-reports'));
  assertNoSymlink(directory);
  if (realpathSync(directory) !== directory) {
    throw new Error('Coverage directory is outside the working tree');
  }

  const inputPath = join(directory, 'coverage-summary.json');
  const jsonOutput = join(directory, 'product-source-summary.json');
  const htmlOutput = join(directory, 'product-source-summary.html');
  for (const path of [inputPath, jsonOutput, htmlOutput]) {
    assertNoSymlink(path);
  }

  const inventoryPath = new URL(
    './monocart-observed-source-baseline.json',
    import.meta.url
  );
  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
  const source = JSON.parse(readFileSync(inputPath, 'utf8'));
  const report = summarizeCoverage(source, inventory.required_mapped_sources);
  writeFileSync(jsonOutput, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(htmlOutput, renderHtml(report));
  return report;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.length !== 2) {
    throw new Error('Report paths are fixed; do not provide CLI arguments');
  }
  const result = generateReport();
  console.log('Product observed-source coverage:', result.product.metrics);
  console.log(
    'Unfiltered observed-source coverage:',
    result.unfiltered_original_source.metrics
  );
  console.warn(result.diagnostics.warning);
  console.warn(
    'Generated/unmapped entries:',
    result.diagnostics.compiled_or_unmapped_entries.length
  );
  console.warn('New mapped sources:', result.diagnostics.new_mapped_sources);
  console.warn('These reports are NOT full application coverage gates.');
}
