# LANGLO-284: private document Library

Local implementation evidence captured on 2026-10-24 with Node 24.19.0 and
npm 11.9.0. The Library adds owner-scoped TXT, text-PDF, DOCX and EPUB uploads,
sentence reading, saved progress, rename/delete, optional translation and
contextual vocabulary lookup. Extracted text is stored; the uploaded binary is
not retained. Saved vocabulary uses the existing native flashcard draft flow.

## Behavior and data boundaries

- Uploads are limited to 10 MiB and extracted content to 1,000,000 characters.
  At most two office parser workers run at once; OCR and remote asset loading
  are off.
- Scanned PDFs with no extracted text and unsupported/unreadable files are
  rejected. The source language is required at upload.
- Document operations, vocabulary lookups and saved terms are scoped to the
  signed-in owner. Account deletion cascades to Library rows.
- Translation and lookup use only the configured OpenAI GPT-6 Luna model with
  low reasoning, `store: false`, and user-requested calls. Lookup sends the
  selected term and current/neighbor sentences; no provider fallback is used.
- AI context is capped at 16,000 serialized characters, with a persistent
  budget of 100 calls per learner and 1,000 total calls per UTC day. Calls are
  reserved before contacting OpenAI, so failed provider attempts count.
- Compose's 11 MiB adapter ceiling supports Library uploads. A bounded body
  reader rejects oversized requests before framework dispatch, limiting other
  routes and auth proxy requests to 512 KiB even without `Content-Length`.
- Target language follows the matching enrollment's explanation language,
  otherwise the first enrollment, otherwise English. TTS remains out of scope
  for this issue.

## Observed RED and GREEN

- Document parser tests initially failed because supported PDF/DOCX/EPUB
  extraction was missing and an image-only PDF was accepted as text. After the
  bounded parser worker and validation were added, `tests/library-documents.test.ts`
  passed 7 tests.
- Persistence tests initially failed because `createLibraryDocument` was
  absent. After adding the owner-scoped service and forward migration, its
  focused suite passed.
- The sentence/highlight test initially failed because
  `src/lib/library-text.ts` did not exist. After adding segmentation and
  whole-word/phrase matching, its tests passed; saved terms are queried without
  an arbitrary result cap.
- Config/AI tests initially failed because private OpenAI configuration and
  the AI service were absent. After implementation, mocked provider tests
  passed without a live provider call.
- API route tests initially failed because Library endpoints were absent. The
  new API routes and owner-scope tests passed against disposable fixtures.
- The AI budget and context-ceiling tests initially failed because the usage
  table and validation were absent; the concurrent-reservation tests and
  mocked provider checks now pass. The database migration is forward-only.
- The first body guard checked only `Content-Length`. Review identified a
  chunked-request gap; byte-counting stream tests were added, then passed for
  public signup and auth proxy requests without that header.

## Local checks

- `npm ci --ignore-scripts`: completed using the required npm version.
- `npm run check`: passed, 0 errors and 0 warnings after the final code changes.
- `npm run lint`: passed after the final code changes.
- Focused Library/config/migration/body-boundary tests: 12 files and 95 tests
  passed.
- `npm test`: 123 files and 1,947 tests passed.
- `npm run test:property`: 6 files and 9 tests passed.
- `npm run build`: passed.
- `npm run test:e2e`: 150 passed (desktop and mobile), including the Library
  upload/read/resume/rename/delete journey and auth body boundaries.
- Prettier passed for every changed supported file. Repository-wide
  `npm run format:check` reports only the globally ignored local file
  `.claude/settings.local.json`; that file was left untouched.
- `git diff --check`: passed.

`npm audit --omit=dev` reports two production advisories already present at the
starting commit: high severity in `zod@4.6.5` and moderate severity in
`nodemailer@10.0.13`. Dependency changes here add `officeparser`; unrelated
advisories were not changed.

## Pending acceptance

No live OpenAI request, CI run, hosted check, production database, deployment,
or remote publication was performed. The AI provider path is unit-tested with
mocked fetch only. Local browser results use synthetic fixtures and do not
establish production behavior.

## Review remediation

The adversarial and deeper code reviews were addressed locally:

- Sentence words are keyboard-accessible lookup buttons. The phrase field
  remains available, and saved words stay clickable inside highlights.
- The word and deck controls are disabled while requests are pending. Saving
  captures the submitted term before awaiting the response.
- Vocabulary identity includes the selected deck, and concurrent duplicate
  saves return the winning note. Hashing the structured identity also fixes a
  newly observed crash at the advertised 4,096-character definition limit.
- An existing card that was manually moved, edited, or untagged produces a
  clear conflict instead of a false save confirmation. Its content, placement,
  and review history are preserved.
- PDFs disguised as TXT are rejected rather than displayed as raw PDF syntax.
- Request limits run before SvelteKit or auth parsers can swallow size errors.
  The reader leaves cancellation to the adapter after the response: cancelling
  the input stream immediately was observed to reset the socket before 413.
- A failed progress save preserves the current translation, definition, and
  selected phrase. These are cleared only after successful navigation.

### Observed regression output

Commands used Node 24.19.0 and npm 11.9.0 (the latter through
`node /tmp/langlo-npm-11.9.0/node_modules/npm/bin/npm-cli.js`). These excerpts
record new regression runs; they do not reconstruct the original implementation
logs summarized above.

Initial regression command:

```text
npm test -- tests/library.test.ts tests/library-documents.test.ts tests/signup-boundary.test.ts

FAIL rejects text.pdf disguised as TXT
AssertionError: promise resolved "{ title: 'book', language: 'en', …(1) }" instead of rejecting
FAIL rejects scanned.pdf disguised as TXT
FAIL saves the same vocabulary to the selected deck
FAIL returns the same note for concurrent duplicate saves
LibsqlError: SQLITE_CONSTRAINT: UNIQUE constraint failed: native_flashcard_notes.owner_id, native_flashcard_notes.source_id
FAIL accepts a definition at the advertised length limit
Error: Invalid card identity: all fields must be nonempty bounded strings
FAIL bounds chunked auth API requests when Content-Length is absent
AssertionError: expected 500 to be 413 // Object.is equality
FAIL bounds chunked public form bodies without Content-Length
AssertionError: expected 500 to be 413 // Object.is equality
Test Files  3 failed (3)
Tests  7 failed | 17 passed (24)
```

After the service fixes:

```text
npm test -- tests/library.test.ts tests/library-documents.test.ts tests/signup-boundary.test.ts tests/request-body.test.ts
Test Files  4 passed (4)
Tests  26 passed (26)
```

Reader regressions against the original built server:

```text
playwright test tests/e2e/library.spec.ts --project=desktop -g 'clicks words.*fr|keeps the selected word'
waiting for getByRole('button', { name: 'Look up maison', exact: true })
Test timeout of 20000ms exceeded.
expect(locator).toBeDisabled() failed
Locator: getByLabel('Select a word or phrase from this sentence')
Expected: disabled
Received: enabled
2 failed
```

The expanded browser run then caught two further failures:

```text
keeps phrase study results when progress saving fails and highlights in another document
expect(locator).toBeVisible() failed
Locator: getByText('little house', { exact: true })
Error: element(s) not found

returns 413 for chunked JSON and form requests through the real server
Error: read ECONNRESET
```

The expanded browser fixture reuses a synthetic login session to stay within
the real auth rate limit. Its OpenAI key is explicitly empty; translation and
definition UI responses are intercepted in Playwright. Saving and reading native
notes, upload parsing, progress, and HTTP body limits use the real built server
and disposable fixture database.

Final focused browser result:

```text
playwright test tests/e2e/library.spec.ts
20 passed (17.3s)
```

Further native-card editing regressions:

```text
vitest run tests/library.test.ts
FAIL reports a moved card instead of claiming an unchanged vocabulary save
FAIL reports a edited card instead of claiming an unchanged vocabulary save
FAIL reports a untagged card instead of claiming an unchanged vocabulary save
AssertionError: promise resolved "{ …(2) }" instead of rejecting
Tests  3 failed | 5 passed (8)

vitest run tests/library.test.ts tests/library-routes.test.ts
Test Files  2 passed (2)
Tests  12 passed (12)
```

### Final validation after remediation

```text
npm ci --ignore-scripts --offline
added 593 packages, and audited 594 packages in 4s

npm run check
svelte-check found 0 errors and 0 warnings

npm run lint
exit 0

npm test
Test Files  123 passed (123)
Tests  1955 passed (1955)

npm run test:property
Test Files  6 passed (6)
Tests  9 passed (9)

npm run build
Using @sveltejs/adapter-node
✔ done

npm run test:e2e
168 passed (2.5m)

prettier --check <all changed supported files>
All matched files use Prettier code style!

git diff --check
exit 0
```

The initial sandboxed full unit run hit `spawnSync ... EPERM` and loopback
`listen EPERM`; the permitted local rerun above passed. An initial full browser
run passed 167/168 tests and failed the existing map-navigation timer assertion
in `exercises.spec.ts`. The final full rerun, without the concurrent unit
workload, passed all 168; no map implementation or timer assertion was changed.
The first failure remains evidence of timing sensitivity, not a confirmed
Library defect.

Repository-wide `npm run format:check` still reports only the pre-existing,
globally ignored `.claude/settings.local.json`. All changed supported files
pass. The final review found no further significant defect in the revised
paths. Live OpenAI quality, remote database concurrency, CI, and deployment
remain unverified; there were no live provider calls.

## Post-rebase PR validation

The feature branch was rebased onto `origin/main` at `7829ddb` and validated on
`62c383a2424f96c028e8787c184bd228a42ddc3d` with Node 24.19.0 and npm 11.9.0:

- `npm run check`: passed with 0 errors and 0 warnings.
- `npm run lint`: passed.
- `npm test`: 125 files and 1,972 tests passed.
- `npm run test:property`: 6 files and 9 tests passed.
- `npm run build`: passed.
- Changed supported files pass Prettier. Repository-wide `npm run format:check`
  still reports only the ignored local `.claude/settings.local.json`.
- `npm run test:e2e`: 169 passed, 1 failed. The failure is the existing
  `tests/e2e/exercises.spec.ts:749` map timer assertion (`mapTimerPending` was
  still true after leaving the map). The same test failed when run alone. No
  map implementation or exercise-test code was changed in this branch; the
  shared app layout change adds the Library navigation link. All Library E2E
  cases passed in the full run. Earlier full runs of this suite have both
  passed and failed this timer assertion, so its status remains unresolved.

The reader capture below was taken with a synthetic document and mocked AI
responses; it contains no learner data or live provider output.

![Library reader with translation and saved-word lookup](LANGLO-284-library.png)

No CI result, hosted acceptance, production database validation, or deployment
is claimed here.
