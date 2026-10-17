import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

function runFixture(cli: string, staleReport = false) {
  const root = mkdtempSync(join(tmpdir(), 'langlo-stryker-cli-'));
  try {
    mkdirSync(join(root, 'scripts'));
    for (const file of ['run-stryker.mjs', 'validate-stryker-report.mjs'])
      copyFileSync(`scripts/${file}`, join(root, 'scripts', file));
    mkdirSync(join(root, 'node_modules/@stryker-mutator/core/bin'), {
      recursive: true
    });
    writeFileSync(
      join(root, 'node_modules/@stryker-mutator/core/bin/stryker.js'),
      cli
    );
    writeFileSync(join(root, 'source.ts'), 'export const value = true;');
    writeFileSync(join(root, 'example.test.ts'), '');
    writeFileSync(
      join(root, 'stryker.config.mjs'),
      `export const mutationScopes = [{name: 'fixture', mutate: ['source.ts'], tests: ['example.test.ts']}]; export default {};`
    );
    if (staleReport) {
      mkdirSync(join(root, 'reports/mutation'), { recursive: true });
      writeFileSync(join(root, 'reports/mutation/fixture.json'), '{}');
    }
    const result = spawnSync(
      process.execPath,
      [join(root, 'scripts/run-stryker.mjs')],
      { encoding: 'utf8' }
    );
    return {
      status: result.status,
      output: result.stdout + result.stderr,
      root
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

it('describes a child-process failure with its scope, command and exit status', () => {
  const result = runFixture(
    `console.error('synthetic worker failure'); process.exitCode = 2;`
  );
  expect(result.status).toBe(1);
  expect(result.output).toContain('synthetic worker failure');
  expect(result.output).toMatch(/scope fixture.*exit (code |status )?2/s);
  expect(result.output).toContain('stryker.js');
});

it('rejects a successful process that wrote no fresh report, removing stale evidence', () => {
  const result = runFixture('', true);
  expect(result.status).toBe(1);
  expect(result.output).toMatch(/scope fixture.*(fresh|missing|read).*report/s);
  expect(result.output).toContain('fixture.json');
  expect(result.output).not.toContain('Unexpected token');
});

it('describes malformed report data instead of silently succeeding', () => {
  const result = runFixture(
    `const fs=require('node:fs');fs.mkdirSync('reports/mutation',{recursive:true});fs.writeFileSync('reports/mutation/fixture.json','{broken');`
  );
  expect(result.status).toBe(1);
  expect(result.output).toMatch(/scope fixture.*(invalid|parse|read).*report/s);
  expect(result.output).toContain('fixture.json');
});

it.each([0, 1])(
  'prints the reported runner error when Stryker exits %i',
  (exitCode) => {
    const report = {
      files: {
        'source.ts': {
          mutants: [
            {
              id: 'broken-mutant',
              mutatorName: 'BooleanLiteral',
              status: 'RuntimeError',
              statusReason: 'synthetic runner broke',
              location: { start: { line: 3, column: 7 } }
            }
          ]
        }
      },
      testFiles: {
        'example.test.ts': { tests: [{ id: '1', name: 'example' }] }
      }
    };
    const result = runFixture(
      `const fs=require('node:fs');fs.mkdirSync('reports/mutation',{recursive:true});fs.writeFileSync('reports/mutation/fixture.json',JSON.stringify(${JSON.stringify(report)}));process.exitCode=${exitCode};`
    );
    expect(result.status).toBe(1);
    expect(result.output).toMatch(
      /source.ts:3:7.*broken-mutant.*synthetic runner broke/s
    );
  }
);

it.each([true, false])(
  'requires fresh HTML as well as valid individual-test JSON (HTML: %s)',
  (writeHtml) => {
    const report = {
      files: {
        'source.ts': {
          mutants: [
            {
              id: '1',
              mutatorName: 'BooleanLiteral',
              status: 'Killed',
              coveredBy: ['test-1'],
              killedBy: ['test-1'],
              testsCompleted: 1,
              statusReason: 'expected true to be false',
              location: { start: { line: 1, column: 1 } }
            }
          ]
        }
      },
      testFiles: {
        'example.test.ts': { tests: [{ id: 'test-1', name: 'example' }] }
      }
    };
    const result = runFixture(
      `const fs=require('node:fs');fs.mkdirSync('reports/mutation',{recursive:true});fs.writeFileSync('reports/mutation/fixture.json',JSON.stringify(${JSON.stringify(report)}));${writeHtml ? "fs.writeFileSync('reports/mutation/fixture.html','<!doctype html>');" : ''}`
    );
    expect(result.status).toBe(writeHtml ? 0 : 1);
    if (!writeHtml) {
      expect(result.output).toMatch(/(fresh|missing).*HTML report/s);
      expect(result.output).not.toContain('scope fixture verified');
      return;
    }
    expect(result.output).toContain(
      'scope fixture verified: 1 named tests; 1 covering mutated code; 1 killing mutants'
    );
    expect(result.output).toContain('fixture.json');
    expect(result.output).toContain('fixture.html');
  }
);
