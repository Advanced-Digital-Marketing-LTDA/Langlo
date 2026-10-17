import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import {
  commonTokens,
  declareFactoryPlugin,
  PluginKind,
  tokens
} from '@stryker-mutator/api/plugin';
import { DryRunStatus, TestStatus } from '@stryker-mutator/api/test-runner';
import { vitestTestRunnerFactory } from '../node_modules/@stryker-mutator/vitest-runner/dist/src/vitest-test-runner.js';

export { strykerValidationSchema } from '@stryker-mutator/vitest-runner';

/** @typedef {{type: string, name: string, tasks?: Task[], suite?: Task, file?: {filepath: string}, result?: {errors?: {name?: string, message?: string, stack?: string}[]}}} Task */
/** @typedef {{testIds?: string[], relatedFiles?: string[], testFiles?: string[]}} Selection */
/** @typedef {(selection?: Selection) => Promise<import('@stryker-mutator/api/test-runner').DryRunResult>} Run */

/** @param {Run} nativeRun @param {() => Task[]} getFiles @param {(files: string[]) => Promise<void>} [collectFiles] @returns {Run} */
export function guardVitestRun(
  nativeRun,
  getFiles,
  collectFiles = async () => {}
) {
  const filters = new Map();
  const errors = new Map();
  /** @param {Task} task */
  function collect(task) {
    if (task.type === 'test' && task.file) {
      const parts = [task.name];
      for (let suite = task.suite; suite; suite = suite.suite)
        parts.unshift(suite.name);
      const file = relative(process.cwd(), task.file.filepath).replaceAll(
        '\\',
        '/'
      );
      filters.set(
        `${file}#${parts.join(' ').trim()}`,
        `${file}#${parts.join(' > ').trim()}`
      );
      errors.set(`${file}#${parts.join(' ').trim()}`, task.result?.errors?.[0]);
    }
    task.tasks?.forEach(collect);
  }
  return /** @param {Selection} [selection] */ async function run(
    selection = {}
  ) {
    const context = `Vitest files: ${(selection.relatedFiles ?? selection.testFiles ?? []).join(', ') || '(selected tests)'}`;
    let result;
    try {
      if (selection.testIds?.some((id) => !filters.has(id))) {
        await collectFiles([
          ...new Set(selection.testIds.map((id) => id.split('#')[0]))
        ]);
        getFiles().forEach(collect);
      }
      const unknown = selection.testIds?.find((id) => !filters.has(id));
      if (unknown)
        return {
          status: DryRunStatus.Error,
          errorMessage: `${context}: unknown coverage test ID ${unknown}; cannot select its test.`
        };
      result = await nativeRun({
        ...selection,
        ...(selection.testIds
          ? { testIds: selection.testIds.map((id) => filters.get(id)) }
          : {})
      });
    } catch (cause) {
      throw new Error(
        `${context}: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause }
      );
    }
    if (result.status === DryRunStatus.Error)
      return { ...result, errorMessage: `${context}: ${result.errorMessage}` };
    if (result.status !== DryRunStatus.Complete) return result;
    if (
      !result.tests.some(
        ({ status }) =>
          status === TestStatus.Success || status === TestStatus.Failed
      )
    ) {
      return {
        status: DryRunStatus.Error,
        errorMessage: `Vitest executed zero tests. ${context}; selected IDs: ${selection.testIds?.join(', ') || '(baseline)'}. Check test files and test-name filters; this is a runner failure, not a surviving mutant.`
      };
    }
    getFiles().forEach(collect);
    for (const test of result.tests) {
      if (test.status !== TestStatus.Failed) continue;
      const error = errors.get(test.id);
      if (
        !test.failureMessage?.trim() &&
        !error?.name &&
        !error?.message &&
        !error?.stack
      )
        return {
          status: DryRunStatus.Error,
          errorMessage: `${context}: test "${test.name}" (${test.id}) failed with no error details; refusing to count an unexplained kill.`
        };
      test.failureMessage = `${test.fileName || test.id} :: ${test.name}\n${test.failureMessage?.trim() || `${error?.name || 'Error'} thrown without a message.`}${error?.stack ? `\n${error.stack}` : ''}`;
    }
    return result;
  };
}

/** @param {import('@stryker-mutator/api/plugin').Injector<import('@stryker-mutator/api/plugin').PluginContext>} injector */
function createRunner(injector) {
  const runnerVersion = JSON.parse(
    readFileSync(
      new URL(
        '../node_modules/@stryker-mutator/vitest-runner/package.json',
        import.meta.url
      ),
      'utf8'
    )
  ).version;
  const vitestVersion = JSON.parse(
    readFileSync(
      new URL('../node_modules/vitest/package.json', import.meta.url),
      'utf8'
    )
  ).version;
  if (runnerVersion !== '10.0.0' || !vitestVersion.startsWith('5.'))
    throw new Error(
      `Unsupported Stryker/Vitest bridge versions: runner ${runnerVersion}, Vitest ${vitestVersion}. Review upstream issue #6210 before updating this compatibility layer.`
    );
  const runner = injector.injectFunction(vitestTestRunnerFactory);
  // shortcut: bridge Stryker 10 runner internals for Vitest 5 names; remove when upstream #6210 is released.
  const adapter =
    /** @type {{run: Run, ctx: {state: {getFiles: () => Task[]}, collect: (files: string[], options: {staticParse: false}) => Promise<{unhandledErrors: {message?: string}[]}>}}} */ (
      /** @type {unknown} */ (runner)
    );
  adapter.run = guardVitestRun(
    adapter.run.bind(runner),
    () => adapter.ctx.state.getFiles(),
    async (files) => {
      const collected = await adapter.ctx.collect(files, {
        staticParse: false
      });
      const errors = [
        ...collected.unhandledErrors,
        ...adapter.ctx.state
          .getFiles()
          .flatMap((file) => file.result?.errors ?? [])
      ];
      if (errors.length)
        throw new Error(
          `Test collection failed: ${errors.map((error) => error.message || JSON.stringify(error)).join('\n')}`
        );
    }
  );
  return runner;
}
createRunner.inject = tokens(commonTokens.injector);
export const strykerPlugins = [
  declareFactoryPlugin(PluginKind.TestRunner, 'langlo-vitest', createRunner)
];
