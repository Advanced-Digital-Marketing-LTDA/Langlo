import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../vite.config';

type NamedPlugin = { name?: string } | false | null | undefined;

const flattenPlugins = (value: unknown): NamedPlugin[] =>
  Array.isArray(value) ? value.flatMap(flattenPlugins) : [value as NamedPlugin];

const pluginNames = async (): Promise<string[]> => {
  const resolved = await Promise.all(
    flattenPlugins(config.plugins).map((plugin) => plugin)
  );
  return flattenPlugins(resolved).map((plugin) =>
    plugin ? (plugin.name ?? '') : ''
  );
};

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });

describe('Sentry Vite plugin setup', () => {
  it('registers the Sentry resolver and tracing variant before SvelteKit', async () => {
    const names = await pluginNames();
    const resolver = names.indexOf('sentry-sveltekit-kit-config-resolver');
    const variant = names.indexOf('sentry-sveltekit-browser-tracing-variant');
    const kit = names.findIndex((name) =>
      name.startsWith('vite-plugin-sveltekit-')
    );

    expect(resolver).toBeGreaterThanOrEqual(0);
    expect(variant).toBeGreaterThanOrEqual(0);
    expect(kit).toBeGreaterThanOrEqual(0);
    expect(resolver).toBeLessThan(kit);
    expect(variant).toBeLessThan(kit);
  });

  it('does not upload source maps or auto-instrument load functions', async () => {
    const names = await pluginNames();

    expect(names).not.toContain('sentry-auto-instrumentation');
    expect(names).not.toContain('sentry-vite-plugin');
    expect(names).not.toContain('sentry-sveltekit-debug-id-upload-plugin');
    expect(names).not.toContain(
      'sentry-sveltekit-update-source-map-setting-plugin'
    );
  });
});

describe('client bundle', () => {
  it('does not contain kit/app_stores_removed after a production build', () => {
    execFileSync('npx', ['vite', 'build'], {
      cwd: new URL('..', import.meta.url),
      stdio: 'pipe'
    });
    const clientDir = new URL('../.svelte-kit/output/client', import.meta.url);
    const files = filesUnder(clientDir.pathname).filter((file) =>
      /\.(js|mjs)$/u.test(file)
    );

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(readFileSync(file, 'utf8'), file).not.toContain(
        'kit/app_stores_removed'
      );
    }
  }, 600_000);
});
