import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  new URL('../.github/workflows/ci.yml', import.meta.url),
  'utf8'
);

describe('Quality coverage upload', () => {
  it('generates LCOV while preserving the machine-readable test evidence', () => {
    expect(workflow).toContain(
      'npm test -- --coverage --coverage.reporter=lcov --reporter=json --reporter=default --outputFile.json=.ci-reports/vitest.json'
    );
  });

  it('uploads the generated report after tests without using secrets on fork PRs', () => {
    const upload = workflow
      .split('      - name: Upload coverage reports to Codecov\n')[1]
      ?.split('\n      - ')[0];
    expect(upload).toBeDefined();
    expect(upload).toContain(
      "if: ${{ github.event_name == 'push' || github.event.pull_request.head.repo.full_name == github.repository }}"
    );
    expect(upload).toContain('uses: codecov/codecov-action@v5');
    expect(upload).toContain('token: ${{ secrets.CODECOV_TOKEN }}');
    expect(upload).toContain('slug: Advanced-Digital-Marketing-LTDA/Langlo');
    expect(upload).toContain('files: ./coverage/lcov.info');
    expect(
      workflow.indexOf('Upload coverage reports to Codecov')
    ).toBeGreaterThan(workflow.indexOf('npm test -- --coverage'));
  });
});
