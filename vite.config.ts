import adapter from '@sveltejs/adapter-node';
import { sentrySvelteKit } from '@sentry/sveltekit/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    sentrySvelteKit({ autoUploadSourceMaps: false, autoInstrument: false }),
    sveltekit({ adapter: adapter(), version: { pollInterval: 300_000 } })
  ]
});
