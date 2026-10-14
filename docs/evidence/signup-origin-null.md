# Signup form rejected as cross-site in production

**Symptom:** submitting `/signup` in a browser returned `Cross-site POST form submissions are forbidden`.

**Cause:** `src/hooks.server.ts` sent `Referrer-Policy: no-referrer`. Under the Fetch standard, a non-GET request from a page with that policy carries `Origin: null`, even when same-origin. SvelteKit's CSRF check compares that with the app origin and rejects it. Existing e2e auth tests set the `Origin` header by hand, so they could not observe this.

**Fix:** use `Referrer-Policy: same-origin`. Same-origin form posts carry the real origin; cross-origin navigations still send no referrer, so reset tokens and private paths do not leak.

**Red (before fix), `tests/e2e/browser-form.spec.ts`:**

```
Expected: "http://127.0.0.1:4331"
Received: "null"
1 failed
```

**Green (after fix):** `2 passed` (desktop, mobile). Local `npm run check`, `lint`, `format:check`, `test` and full `test:e2e` (64 passed) pass.

**Pending acceptance:** a production signup after redeploy. Local checks do not prove the deployed proxy configuration.
