import assert from 'node:assert/strict';
import { access, readFile, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { mutationScopes } from '../stryker.config.mjs';
import { validateMutationReport } from './validate-stryker-report.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const propertySeed = process.env.FC_SEED ?? '0';
assert.equal(
  new Set(mutationScopes.map(({ name }) => name)).size,
  mutationScopes.length
);

for (const scope of mutationScopes) {
  assert.ok(
    scope.mutate.length && scope.tests.length,
    `${scope.name} must include source and test files`
  );
  await Promise.all(
    [...scope.mutate, ...scope.tests].map(async (file) => {
      try {
        await access(resolve(root, file));
      } catch (cause) {
        throw new Error(
          `Stryker scope ${scope.name}: cannot access configured file ${file}`,
          { cause }
        );
      }
    })
  );
}

const stryker = fileURLToPath(
  new URL(
    '../node_modules/@stryker-mutator/core/bin/stryker.js',
    import.meta.url
  )
);
const config = fileURLToPath(new URL('../stryker.config.mjs', import.meta.url));
try {
  for (const scope of mutationScopes) {
    const label = `Stryker scope ${scope.name}`;
    const reportPath = resolve(root, `reports/mutation/${scope.name}.json`);
    const htmlPath = resolve(root, `reports/mutation/${scope.name}.html`);
    const args = [stryker, 'run', config, '--ignoreStatic'];
    const command = [process.execPath, ...args]
      .map((arg) => JSON.stringify(arg))
      .join(' ');
    process.stdout.write(
      `\n${label}\nSources: ${scope.mutate.join(', ')}\nTests: ${scope.tests.join(', ')}\nProperty seed (FC_SEED): ${propertySeed}\n`
    );
    try {
      await rm(reportPath, { force: true });
      await rm(htmlPath, { force: true });
      const result = spawnSync(process.execPath, args, {
        cwd: root,
        env: {
          ...process.env,
          FC_SEED: propertySeed,
          LANGLO_STRYKER_SCOPE: scope.name
        },
        stdio: 'inherit'
      });
      if (result.error)
        throw new Error(
          `Could not start the test process: ${result.error.message}`,
          { cause: result.error }
        );
      if (result.signal)
        throw new Error(`Test process terminated by signal ${result.signal}.`);
      const processFailure =
        result.status === 0
          ? ''
          : `Test process failed with exit code ${result.status}. `;
      let report;
      try {
        report = JSON.parse(await readFile(reportPath, 'utf8'));
      } catch (cause) {
        throw new Error(
          `${processFailure}Could not read a fresh, valid JSON report: ${reportPath}`,
          { cause }
        );
      }
      let summary;
      try {
        summary = validateMutationReport(report, scope);
      } catch (cause) {
        throw new Error(
          `${processFailure}Invalid mutation report: ${cause instanceof Error ? cause.message : String(cause)}`,
          { cause }
        );
      }
      if (processFailure)
        throw new Error(
          `${processFailure}See the score table and diagnostics above.`
        );
      try {
        assert((await stat(htmlPath)).size > 0, 'The HTML report is empty.');
      } catch (cause) {
        throw new Error(`Missing or empty fresh HTML report: ${htmlPath}`, {
          cause
        });
      }
      console.log(
        `${label} verified: ${summary.tests} named tests; ${summary.coveringTests} covering mutated code; ${summary.killingTests} killing mutants.\nMutants: ${summary.mutants}; killed: ${summary.killed}; survived: ${summary.survived}; timeouts: ${summary.timeout}; uncovered: ${summary.noCoverage}; ignored: ${summary.ignored}.\nReports: ${reportPath} and ${htmlPath}`
      );
      for (const [file, result] of Object.entries(report.files)) {
        for (const mutant of result.mutants) {
          if (mutant.status === 'NoCoverage' || mutant.status === 'Timeout')
            console.warn(
              `${label}: ${file}:${mutant.location.start.line}:${mutant.location.start.column} mutant ${mutant.id}: ${mutant.status}. ${mutant.statusReason || (mutant.status === 'NoCoverage' ? 'No selected test covers this mutation; add coverage or review the source scope.' : 'The mutant exceeded its test timeout; Stryker counts this separately from assertion-based kills.')}`
            );
        }
      }
    } catch (cause) {
      throw new Error(
        `${label} failed. Command: ${command}\nExpected report: ${reportPath}\n${cause instanceof Error ? cause.message : String(cause)}`,
        { cause }
      );
    }
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
