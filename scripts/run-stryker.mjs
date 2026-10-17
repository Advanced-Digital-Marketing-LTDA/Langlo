import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { mutationScopes } from '../stryker.config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
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
    [...scope.mutate, ...scope.tests].map((file) => access(resolve(root, file)))
  );
}

const stryker = fileURLToPath(
  new URL(
    '../node_modules/@stryker-mutator/core/bin/stryker.js',
    import.meta.url
  )
);
const config = fileURLToPath(new URL('../stryker.config.mjs', import.meta.url));
for (const scope of mutationScopes) {
  process.stdout.write(`\nStryker scope: ${scope.name}\n`);
  const result = spawnSync(
    process.execPath,
    [stryker, 'run', config, '--ignoreStatic'],
    {
      cwd: root,
      env: { ...process.env, LANGLO_STRYKER_SCOPE: scope.name },
      stdio: 'inherit'
    }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
