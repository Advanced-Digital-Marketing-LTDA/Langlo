import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import config from '../stryker.config.mjs';

it('passes the active mutant and failing exit status through the configured test command', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'langlo-stryker-command-'));
  try {
    const vitest = join(sandbox, 'node_modules/vitest');
    await mkdir(vitest, { recursive: true });
    await writeFile(
      join(vitest, 'vitest.mjs'),
      `process.stdout.write(process.env.__STRYKER_ACTIVE_MUTANT__ ?? 'missing');
process.exitCode = 1;
`
    );
    const result = spawnSync(config.commandRunner.command, {
      cwd: sandbox,
      shell: true,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: sandbox,
        __STRYKER_ACTIVE_MUTANT__: '12'
      }
    });
    expect(result.error).toBeUndefined();
    expect(result.stdout).toBe('12');
    expect(result.status).toBe(1);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
