import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { summarizeCoverage, renderHtml } from './report-product-coverage.mjs';
const row = (covered,total) => ({covered,total});
function fixture() {
  const entry=(c,t)=>({lines:row(c,t),statements:row(c,t),branches:row(c,t),functions:row(c,t)});
  return {
    total:entry(0,900),
    '127.0.0.1-123/_app/immutable/entry/app.js':entry(0,500),
    '127.0.0.1-456/_app/immutable/entry/app.js':entry(0,500),
    'src/lib/glitchtip/scrub-event.ts':entry(0,100),
    'src/routes/app/learn/+page.svelte':entry(8,10),
    'src/lib/components/exercises/answer.ts':entry(5,10)
  };
}
test('only excludes telemetry from product source; retains full diagnostic', () => {
  const report=summarizeCoverage(fixture());
  assert.deepEqual(report.product.metrics.lines,{covered:13,total:20,percent:65});
  assert.deepEqual(report.unfiltered_original_source.metrics.lines,{covered:13,total:120,percent:10.83});
  assert.deepEqual(report.product.files,['src/lib/components/exercises/answer.ts','src/routes/app/learn/+page.svelte']);
  assert.deepEqual(report.exclusions.map(x=>x.path),['src/lib/glitchtip/scrub-event.ts']);
  assert.equal(report.diagnostics.compiled_or_unmapped_entries.length,2);
  assert.match(renderHtml(report),/not full application coverage/i);
});
test('does not quietly ignore malformed source coverage', () => {
  const input=fixture();
  delete input['src/routes/app/learn/+page.svelte'].branches;
  assert.throws(()=>summarizeCoverage(input),/Invalid branches coverage/);
});
test('does not report zero-source data as successful coverage', () => {
  assert.throws(()=>summarizeCoverage({total:fixture().total}),/Missing mapped original/);
});
test('does not silently drop all product files', () => {
  const input=fixture();
  delete input['src/routes/app/learn/+page.svelte'];
  delete input['src/lib/components/exercises/answer.ts'];
  assert.throws(()=>summarizeCoverage(input),/No product source/);
});
