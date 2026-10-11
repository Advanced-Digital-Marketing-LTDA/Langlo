import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readReportFile } from '../scripts/report-path.mjs';

describe('CI report path resolution', () => {
  it('reads a report inside the working directory', () => {
    expect(readReportFile('package.json')).toContain('"name": "langlo"');
  });

  it('reads a report under the system temporary directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'langlo-report-'));
    try {
      const file = join(dir, 'report.json');
      writeFileSync(file, '{}');
      expect(readReportFile(file)).toBe('{}');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a report path outside every allowed root', () => {
    expect(() => readReportFile('/dev/null')).toThrow(/outside/u);
  });

  it('rejects a report that cannot be read', () => {
    expect(() => readReportFile('tests/fixtures/does-not-exist.json')).toThrow(
      /could not be read/u
    );
  });
});
