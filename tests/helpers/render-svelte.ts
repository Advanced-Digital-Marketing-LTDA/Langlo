import { resolve } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { render } from 'svelte/server';

const root = resolve(import.meta.dirname, '../..');
let server: Promise<ViteDevServer> | undefined;

function viteServer() {
  server ??= createServer({
    root,
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
    plugins: [svelte({ compilerOptions: { runes: true, dev: false } })],
    resolve: {
      alias: {
        '$app/state': resolve(import.meta.dirname, 'app-state-stub.ts')
      }
    }
  });
  return server;
}

/** Server-renders a .svelte file (path from the repo root) to an HTML string. */
export async function renderSvelte(
  file: string,
  props: Record<string, unknown> = {}
) {
  const vite = await viteServer();
  const module = await vite.ssrLoadModule(`/${file}`);
  return render(module.default, { props }).body;
}

export async function closeRenderServer() {
  await (await server)?.close();
  server = undefined;
}
