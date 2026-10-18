import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  generateReport,
  renderHtml,
  runReportCli,
  summarizeCoverage
} from '../scripts/report-product-coverage.mjs';

const productA = 'src/routes/app/learn/+page.svelte';
const productB = 'src/lib/components/exercises/answer.ts';
const telemetry = 'src/lib/glitchtip/scrub-event.ts';
const expected = [productA, productB, telemetry];

const entry = (covered = 1) => ({
  lines: { covered: 8 * covered, total: 10 },
  statements: { covered: 7 * covered, total: 10 },
  functions: { covered: 2 * covered, total: 4 },
  branches: { covered, total: 6 }
});

type CoverageMetric = { covered: number; total: number };
type CoverageEntry = Record<
  'lines' | 'statements' | 'functions' | 'branches',
  CoverageMetric
>;

function fixture(): Record<string, CoverageEntry> {
  return {
    total: entry(),
    'localhost/_app/immutable/main.js': entry(),
    [productA]: entry(),
    [productB]: {
      lines: { covered: 5, total: 10 },
      statements: { covered: 4, total: 10 },
      functions: { covered: 1, total: 3 },
      branches: { covered: 3, total: 7 }
    },
    [telemetry]: {
      lines: { covered: 0, total: 100 },
      statements: { covered: 0, total: 200 },
      functions: { covered: 0, total: 17 },
      branches: { covered: 0, total: 21 }
    }
  };
}

describe('Monocart product coverage validation', () => {
  it('separates all four product metrics without dropping unfiltered data', () => {
    const report = summarizeCoverage(fixture(), expected);
    expect(report.product.metrics).toEqual({
      lines: { covered: 13, total: 20, percent: 65 },
      statements: { covered: 11, total: 20, percent: 55 },
      functions: { covered: 3, total: 7, percent: 42.86 },
      branches: { covered: 4, total: 13, percent: 30.77 }
    });
    expect(report.unfiltered_original_source.metrics.lines).toEqual({
      covered: 13,
      total: 120,
      percent: 10.83
    });
    expect(report.product.files).not.toContain(telemetry);
    expect(report.unfiltered_original_source.files).toContain(telemetry);
    expect(report.diagnostics.compiled_or_unmapped_entries).toEqual([
      'localhost/_app/immutable/main.js'
    ]);
  });

  it('rejects invalid root, source and telemetry-only coverage', () => {
    expect(() => summarizeCoverage(null, expected)).toThrow(
      /Missing Monocart total/
    );
    const invalid = fixture();
    Object.assign(invalid, { [productA]: null });
    expect(() => summarizeCoverage(invalid, expected)).toThrow(
      /Invalid source coverage object/
    );
    const telemetryOnly = {
      total: entry(),
      [telemetry]: entry()
    };
    expect(() => summarizeCoverage(telemetryOnly, [telemetry])).toThrow(
      /No product source files/
    );
  });

  it('does not render a report with a missing metric', () => {
    const report = summarizeCoverage(fixture(), expected);
    delete report.product.metrics.lines;
    expect(() => renderHtml(report)).toThrow(/Missing report metric/);
  });

  it('fails closed when one previously mapped product module vanishes', () => {
    const data = fixture();
    delete data[productB];
    expect(() => summarizeCoverage(data, expected)).toThrow(
      /Missing baseline mapped source/
    );
  });

  it('rejects malformed report metrics, not just missing metrics', () => {
    const data = fixture();
    Object.assign(data[productA]!, { branches: undefined });
    expect(() => summarizeCoverage(data, expected)).toThrow(
      /Invalid branches coverage/
    );
    Object.assign(data[productA]!, { branches: { covered: -1, total: 8 } });
    expect(() => summarizeCoverage(data, expected)).toThrow(
      /Invalid branches coverage/
    );
  });

  it('fails on an absent inventory and zero product denominator', () => {
    expect(() => summarizeCoverage({ total: entry() }, expected)).toThrow(
      /Missing mapped original/
    );
    expect(() => summarizeCoverage(fixture(), [])).toThrow(/inventory/);
    const input = fixture();
    for (const path of [productA, productB]) {
      input[path] = {
        lines: { covered: 0, total: 0 },
        statements: { covered: 0, total: 0 },
        functions: { covered: 0, total: 0 },
        branches: { covered: 0, total: 0 }
      };
    }
    expect(() => summarizeCoverage(input, expected)).toThrow(
      /Empty lines coverage denominator/
    );
  });

  it('escapes HTML payloads from source paths and computed report values', () => {
    const attack = 'src/lib/glitchtip/<img src=x onerror=alert(1)>.ts';
    const input = fixture();
    input[attack] = entry();
    const report = summarizeCoverage(input, [...expected, attack]);
    const html = renderHtml(report);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    Object.assign(report.product.metrics.lines, {
      covered: '<script>alert(1)</script>'
    });
    expect(renderHtml(report)).not.toContain('<script>');
  });
});

describe('Monocart coverage report output', () => {
  it('writes both reports in the existing Monocart output folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'langlo-coverage-'));
    const folder = join(dir, '.ci-reports', 'playwright-coverage');
    mkdirSync(folder, { recursive: true });
    try {
      const inventory = JSON.parse(
        readFileSync(
          new URL(
            '../scripts/monocart-observed-source-baseline.json',
            import.meta.url
          ),
          'utf8'
        )
      );
      const original = fixture();
      for (const path of inventory.required_mapped_sources) {
        if (!Object.hasOwn(original, path)) original[path] = entry();
      }
      writeFileSync(
        join(folder, 'coverage-summary.json'),
        JSON.stringify(original)
      );
      const output = generateReport(dir);
      expect(output.product.metrics.lines.covered).toBeGreaterThan(0);
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        expect(() => runReportCli(['node', 'script', 'extra'], dir)).toThrow(
          /do not provide CLI arguments/
        );
        expect(
          runReportCli(['node', 'script'], dir).product.metrics.lines
        ).toEqual(output.product.metrics.lines);
        expect(log).toHaveBeenCalledWith(
          'Product observed-source coverage:',
          output.product.metrics
        );
        expect(warn).toHaveBeenCalledWith('Generated/unmapped entries:', 1);
      } finally {
        log.mockRestore();
        warn.mockRestore();
      }
      const json = JSON.parse(
        readFileSync(join(folder, 'product-source-summary.json'), 'utf8')
      );
      expect(json.product.files).not.toContain(telemetry);
      expect(json.unfiltered_original_source.files).toContain(telemetry);
      expect(
        readFileSync(join(folder, 'product-source-summary.html'), 'utf8')
      ).toContain('Observed-source diagnostic');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects output symlinks before writing any report', () => {
    const dir = mkdtempSync(join(tmpdir(), 'langlo-coverage-symlink-'));
    const folder = join(dir, '.ci-reports', 'playwright-coverage');
    mkdirSync(folder, { recursive: true });
    try {
      symlinkSync(
        join(dir, 'unrelated-file.json'),
        join(folder, 'product-source-summary.json')
      );
      expect(() => generateReport(dir)).toThrow(/symlinked/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
