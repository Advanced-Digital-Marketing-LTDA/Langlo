import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FullConfig } from '@playwright/test';
import { afterEach, describe, expect, it } from 'vitest';
import setup, {
  assertRenderedText,
  prepareBrowserEnvironment
} from '../scripts/playwright-environment.mjs';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function hostCache() {
  const path = mkdtempSync(join(tmpdir(), 'langlo-host-cache-test-'));
  cleanups.push(() => rmSync(path, { recursive: true, force: true }));
  writeFileSync(join(path, 'keep'), 'unrelated host cache');
  return path;
}

describe('Playwright browser environment', () => {
  it('isolates the Linux browser cache without relocating the runner or browser downloads', () => {
    const previous = hostCache();
    const source = {
      XDG_CACHE_HOME: previous,
      PATH: '/synthetic/bin',
      PLAYWRIGHT_BROWSERS_PATH: '/synthetic/browsers',
      PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: '/synthetic/chromium'
    };
    const prepared = prepareBrowserEnvironment('linux', source);
    cleanups.push(prepared.cleanup);
    expect(prepared.env.XDG_CACHE_HOME).not.toBe(previous);
    expect(existsSync(prepared.env.XDG_CACHE_HOME!)).toBe(true);
    expect(source.XDG_CACHE_HOME).toBe(previous);
    expect(prepared.env.PATH).toBe('/synthetic/bin');
    expect(prepared.env.PLAYWRIGHT_BROWSERS_PATH).toBe('/synthetic/browsers');
    expect(prepared.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH).toBe(
      '/synthetic/chromium'
    );
    expect(readFileSync(join(previous, 'keep'), 'utf8')).toBe(
      'unrelated host cache'
    );
  });

  it('creates a separate empty cache for each independent run and only cleans owned directories', () => {
    const previous = hostCache();
    const first = prepareBrowserEnvironment('linux', {
      XDG_CACHE_HOME: previous
    });
    const second = prepareBrowserEnvironment('linux', {
      XDG_CACHE_HOME: previous
    });
    cleanups.push(first.cleanup, second.cleanup);
    expect(first.env.XDG_CACHE_HOME).not.toBe(second.env.XDG_CACHE_HOME);
    writeFileSync(
      join(first.env.XDG_CACHE_HOME!, 'generated-cache'),
      'generated'
    );
    first.cleanup();
    first.cleanup();
    expect(existsSync(first.env.XDG_CACHE_HOME!)).toBe(false);
    expect(existsSync(second.env.XDG_CACHE_HOME!)).toBe(true);
    expect(readFileSync(join(previous, 'keep'), 'utf8')).toBe(
      'unrelated host cache'
    );
  });

  it('shares the cache with worker processes without giving workers ownership of cleanup', () => {
    const source = {};
    const parent = prepareBrowserEnvironment('linux', source);
    const worker = prepareBrowserEnvironment('linux', { ...source });
    cleanups.push(parent.cleanup, worker.cleanup);
    expect(parent.env.XDG_CACHE_HOME).toEqual(expect.any(String));
    expect(worker.env.XDG_CACHE_HOME).toBe(parent.env.XDG_CACHE_HOME);
    worker.cleanup();
    expect(existsSync(parent.env.XDG_CACHE_HOME!)).toBe(true);
    parent.cleanup();
    expect(existsSync(parent.env.XDG_CACHE_HOME!)).toBe(false);
    expect(source).toEqual({});
  });

  it.each(['darwin', 'win32'])(
    'preserves the browser environment on %s',
    (platform) => {
      const source = {
        XDG_CACHE_HOME: '/synthetic/existing',
        PATH: '/synthetic/bin'
      };
      const prepared = prepareBrowserEnvironment(platform, source);
      cleanups.push(prepared.cleanup);
      expect(prepared.env).toEqual(source);
      expect(source).toEqual({
        XDG_CACHE_HOME: '/synthetic/existing',
        PATH: '/synthetic/bin'
      });
    }
  );

  it.each([null, { width: 100, height: 0 }, { width: 0, height: 25 }])(
    'rejects unusable text dimensions %s',
    (box) => {
      expect(() => assertRenderedText(box)).toThrow(/fonts|Fontconfig/);
    }
  );

  it('accepts rendered text with positive dimensions', () => {
    expect(() => assertRenderedText({ width: 100, height: 25 })).not.toThrow();
  });

  it('reports a missing browser once and removes its owned cache on setup failure', async () => {
    const prepared = prepareBrowserEnvironment('linux', {});
    cleanups.push(prepared.cleanup);
    const config = {
      projects: [
        {
          use: {
            launchOptions: {
              executablePath: join(hostCache(), 'missing-chromium'),
              env: prepared.env
            }
          }
        }
      ]
    } as FullConfig;
    await expect(setup(config)).rejects.toThrow(/preflight.*failed/i);
    expect(existsSync(prepared.env.XDG_CACHE_HOME!)).toBe(false);
  });
});
