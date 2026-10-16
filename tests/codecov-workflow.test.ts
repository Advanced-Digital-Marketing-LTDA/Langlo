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

  it('hands the coverage artifact to the shared workflow without using secrets on fork PRs', () => {
    const upload = workflow
      .split('      - name: Upload coverage artifact\n')[1]
      ?.split('\n      - ')[0];
    expect(upload).toBeDefined();
    expect(upload).toContain('uses: actions/upload-artifact@');
    expect(upload).toContain('name: coverage');
    expect(upload).toContain('path: coverage/lcov.info');
    expect(upload).toContain('if-no-files-found: error');
    const job = workflow.split('\n  codecov:\n')[1]?.split(/\n {2}\S/u)[0];
    expect(job).toBeDefined();
    expect(job).toContain('needs: foundation');
    expect(job).toContain(
      "if: ${{ github.event_name == 'push' || github.event.pull_request.head.repo.full_name == github.repository }}"
    );
    expect(job).toMatch(
      /uses: Advanced-Digital-Marketing-LTDA\/workflows\/\.github\/workflows\/codecov\.yml@[a-f0-9]{40}/u
    );
    expect(job).toContain('artifact-name: coverage');
    expect(job).toContain('CODECOV_TOKEN: ${{ secrets.CODECOV_TOKEN }}');
    expect(workflow).not.toContain('codecov/codecov-action@');
    expect(workflow).not.toContain(
      'slug: Advanced-Digital-Marketing-LTDA/Langlo'
    );
    expect(workflow.indexOf('Upload coverage artifact')).toBeGreaterThan(
      workflow.indexOf('npm test -- --coverage')
    );
  });
});
