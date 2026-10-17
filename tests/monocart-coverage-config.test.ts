import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import coverageOptions from '../scripts/monocart-coverage.config.mjs';

const client = resolve('build/client');
const mapsRoot = join(client, '_app/immutable/chunks');
let temporaryRoot: string | undefined;
const mapNames: string[] = [];

afterEach(async () => {
  await Promise.all(
    mapNames.map((name) =>
      rm(join(mapsRoot, name), { recursive: true, force: true })
    )
  );
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
  mapNames.length = 0;
});

async function createMap(name: string, sources: string[], mappings = 'AAAA') {
  mapNames.push(name);
  const path = join(mapsRoot, name);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, JSON.stringify({ sources, mappings }));
}

describe('Playwright source coverage filters', () => {
  it('includes only mapped application JavaScript entries and original src sources', async () => {
    const options = coverageOptions;
    expect(options.outputDir).toBe('.ci-reports/playwright-coverage');
    expect(options.reports).toContain('v8');
    expect(options.reports).toContain('lcov');
    const appMap = `app-${crypto.randomUUID()}.js.map`;
    const dependencyMap = `vendor-${crypto.randomUUID()}.js.map`;
    const emptyMap = `empty-${crypto.randomUUID()}.js.map`;
    await createMap(appMap, ['../../../../src/lib/client.ts']);
    await createMap(dependencyMap, ['../../../../node_modules/pkg/index.js']);
    await createMap(emptyMap, ['../../../../src/unmapped.ts'], '');

    expect(
      options.entryFilter({
        url: `http://localhost/_app/immutable/chunks/${appMap.slice(0, -4)}`
      })
    ).toBe(true);
    expect(
      options.entryFilter({
        url: `http://localhost/_app/immutable/chunks/${dependencyMap.slice(0, -4)}`
      })
    ).toBe(false);
    expect(
      options.entryFilter({
        url: `http://localhost/_app/immutable/chunks/${emptyMap.slice(0, -4)}`
      })
    ).toBe(false);
    expect(
      options.entryFilter({
        url: 'http://localhost/_app/immutable/chunks/style.css'
      })
    ).toBe(false);
    expect(options.sourceFilter('../../../../src/lib/client.ts')).toBe(true);
    expect(options.sourceFilter('../../../../node_modules/pkg/index.js')).toBe(
      false
    );
    expect(
      options.sourceFilter('../../../../src/node_modules/pkg/index.js')
    ).toBe(false);
    expect(options.sourceFilter('virtual:generated/client')).toBe(false);
    await expect(
      options.sourceMapResolver(
        `http://localhost/_app/immutable/chunks/${appMap}`,
        async () => undefined
      )
    ).resolves.toMatchObject({ sources: ['../../../../src/lib/client.ts'] });
  });

  it('rejects a source map reached through a symlink outside build/client', async () => {
    const options = coverageOptions;
    temporaryRoot = await mkdtemp(join(tmpdir(), 'langlo-monocart-outside-'));
    const name = `linked-${crypto.randomUUID()}.js.map`;
    mapNames.push(name);
    const outsideMap = join(temporaryRoot, 'outside.js.map');
    const linkedMap = join(mapsRoot, name);
    await writeFile(
      outsideMap,
      JSON.stringify({ sources: ['../../../../src/forbidden.ts'] })
    );
    await mkdir(join(linkedMap, '..'), { recursive: true });
    await symlink(outsideMap, linkedMap);

    expect(() =>
      options.entryFilter({
        url: `http://localhost/_app/immutable/chunks/${name.slice(0, -4)}`
      })
    ).toThrow(/escapes/u);
    await expect(
      options.sourceMapResolver(
        `http://localhost/_app/immutable/chunks/${name}`,
        async () => undefined
      )
    ).rejects.toThrow(/escapes/u);
  });

  it('ignores traversal and unsupported entries outside the client source-map tree', async () => {
    const options = coverageOptions;

    expect(
      options.entryFilter({
        url: 'http://localhost/_app/immutable/../../../../outside.js'
      })
    ).toBe(false);
    expect(
      options.entryFilter({ url: 'http://localhost/assets/unsupported.js' })
    ).toBe(false);
  });
});
