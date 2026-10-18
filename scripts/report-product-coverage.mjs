import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const metrics = ['lines', 'statements', 'functions', 'branches'];
export const excludedTelemetry = ['src/lib/glitchtip/'];

export function summarizeCoverage(input) {
  if (!input || typeof input !== 'object' || !input.total) throw new Error('Missing Monocart total');
  const keys = Object.keys(input).filter((key) => key.startsWith('src/')).sort();
  if (!keys.length) throw new Error('Missing mapped original src/ files; refusing an empty success');
  const excluded = keys.filter((key) => excludedTelemetry.some((path) => key.startsWith(path)));
  const included = keys.filter((key) => !excluded.includes(key));
  if (!included.length) throw new Error('No product source files to measure');
  const rollup = (files) => Object.fromEntries(metrics.map((metric) => {
    const totals = files.reduce((out, path) => {
      const value = input[path]?.[metric];
      if (!value || !Number.isInteger(value.total) || !Number.isInteger(value.covered) ||
        value.covered < 0 || value.total < 0 || value.covered > value.total) {
        throw new Error('Invalid '+metric+' coverage for '+path);
      }
      out.covered += value.covered;
      out.total += value.total;
      return out;
    }, { covered: 0, total: 0 });
    return [metric, { ...totals, percent: totals.total ? +((totals.covered / totals.total) * 100).toFixed(2) : null }];
  }));
  const firstPartyBundles = Object.keys(input).filter((key) => key !== 'total' && !key.startsWith('src/')).sort();
  return {
    schema_version: 1,
    scope: 'observed-source-only-not-whole-repository',
    caveat: 'Only mapped original src/ entries emitted by Monocart are measured. Files not discovered by V8 are not in the denominator; this is NOT a verified repository-wide 80% gate.',
    policy: 'Exclude only logging/telemetry integration from product-focused metrics. Never exclude learner-facing functionality.',
    product: { metrics: rollup(included), files: included },
    unfiltered_original_source: { metrics: rollup(keys), files: keys },
    exclusions: excluded.map((path) => ({ path, reason: 'GlitchTip logging/telemetry integration; tested separately with Vitest' })),
    diagnostics: { compiled_or_unmapped_entries: firstPartyBundles, warning: firstPartyBundles.length ? 'Monocart raw total includes generated/unmapped JavaScript. Not used as product coverage.' : null }
  };
}

export function renderHtml(report) {
  const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const table = (title, section) => '<h2>'+esc(title)+'</h2><table><thead><tr><th>Metric</th><th>Covered</th><th>Total</th><th>Percent</th></tr></thead><tbody>'+
    metrics.map((m) => { const v=section.metrics[m]; return '<tr><td>'+esc(m)+'</td><td>'+v.covered+'</td><td>'+v.total+'</td><td>'+ (v.percent === null ? 'n/a' : v.percent+'%')+'</td></tr>'; }).join('')+'</tbody></table>';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Langlo E2E coverage scopes</title><style>body{font:16px/1.5 system-ui;max-width:900px;margin:32px auto;padding:0 16px}table{border-collapse:collapse;width:100%}td,th{text-align:left;border-bottom:1px solid #aaa;padding:7px}code{overflow-wrap:anywhere}p{max-width:70ch}</style></head><body><h1>Langlo E2E source coverage</h1><p><strong>Observed-source diagnostic, not full application coverage.</strong> '+esc(report.caveat)+'</p>'+table('Product source (GlitchTip excluded)',report.product)+table('Unfiltered original source',report.unfiltered_original_source)+'<h2>Excluded telemetry</h2><ul>'+report.exclusions.map((x)=>'<li><code>'+esc(x.path)+'</code> — '+esc(x.reason)+'</li>').join('')+'</ul><h2>Attribution warnings</h2><p>'+esc(report.diagnostics.warning ?? 'None')+'</p><p>Generated/unmapped entries: '+report.diagnostics.compiled_or_unmapped_entries.length+'. See the original Monocart HTML report for individual source paths and uncovered branches.</p></body></html>';
}

export function generate(inputPath, outputPath) {
  const input = JSON.parse(readFileSync(inputPath, 'utf8'));
  const report = summarizeCoverage(input);
  mkdirSync(dirname(outputPath), {recursive:true});
  writeFileSync(outputPath, JSON.stringify(report, null, 2)+'\n');
  writeFileSync(outputPath.replace(/\.json$/,'.html'), renderHtml(report));
  return report;
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  const [input='.ci-reports/playwright-coverage/coverage-summary.json',output='.ci-reports/playwright-coverage/product-source-summary.json'] = process.argv.slice(2);
  const result = generate(input,output);
  console.log('Product observed-source percentages:',result.product.metrics);
  console.log('Unfiltered observed-source percentages:',result.unfiltered_original_source.metrics);
  console.log('Coverage scope is NOT a validated whole-application 80% gate.');
}
