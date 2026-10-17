import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  new URL('../.github/workflows/ci.yml', import.meta.url),
  'utf8'
);

describe('Playwright coverage artifact upload', () => {
  it('uploads the generated HTML and source coverage reports and fails if they are missing', () => {
    const upload = workflow
      .split('      - name: Upload Playwright reports\n')[1]
      ?.split('\n      - ')[0];

    expect(upload).toBeDefined();
    expect(upload).toContain('if: always()');
    expect(upload).toContain('name: playwright-reports-${{ github.sha }}');
    expect(upload).toContain(
      '.ci-reports/playwright/playwright-test-report.html'
    );
    expect(upload).toContain('.ci-reports/playwright-coverage/');
    expect(upload).toContain('if-no-files-found: error');
  });
});
