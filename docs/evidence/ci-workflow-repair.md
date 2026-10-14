# CI workflow repair — 2026-10-10

Branch: `codex/ci-baseline-fixes`, based on main `d6e7a46ec0a22f7be8455bcd6d0e7f1c48d13643`. Workflow repair commit: `4041059`. Kept separate from T003 and its uncommitted storage fixes.

## Reproduced failures

PR #6 at `65d18ff` failed its [ESLint installation](https://github.com/Bonobo791/Langlo/actions/runs/38080467972/job/114296147258): the workflow installed ESLint 8.10.0 despite the project requiring ESLint 10.12.0 and @eslint/js 10.0.1, producing ERESOLVE. It also referenced the absent `.eslintrc.js` rather than the repository's flat configuration.

The [Quality job](https://github.com/Bonobo791/Langlo/actions/runs/38080467984/job/114296147236) passed lint, then failed formatting on `.github/workflows/eslint.yml` and `.github/workflows/ossar.yml`. GitHub checked out merge `86a10ab`, incorporating these main-branch workflows. They are absent from the standalone T003 branch, explaining its passing local formatting check. Checking the original ESLint workflow through Prettier stdin independently returned exit 1.

## Repair and validation

The ESLint workflow uses Node 24.19.0/npm 11.9.0, `npm ci`, and `npm run lint` with the existing flat configuration. Its pinned SARIF formatter is installed without saving dependencies or changing the lockfile. The checkout uses the existing reviewed SHA and disables credential persistence. The existing scanner scope, triggers, permissions and result-upload behavior remain in place. Both affected workflows were formatted; no application dependencies or quality thresholds changed.

Validated in disposable worktree `/tmp/langlo-ci-repair`, using Node 24.19.0 and `npm exec --cache=/tmp/langlo-npm-cache --yes --package=npm@11.9.0 -- …` (subsequent commands add `--offline`):

- `npm ci`: passed, 215 packages; four moderate audit findings reported.
- `npm install --no-save --package-lock=false @microsoft/eslint-formatter-sarif@3.1.0`: passed; root ESLint remains 10.12.0. The formatter brings deprecated transitive packages; it is unchanged from the existing workflow's dependency choice.
- `npm run lint -- --format @microsoft/eslint-formatter-sarif --output-file /tmp/langlo-ci-eslint-results.sarif`: passed; generated SARIF 2.1.0, one run, zero findings. Output path alone differs from the workflow to keep the local artifact outside git.
- `npm run check`: zero errors/warnings.
- `npm run lint`, `npm run format:check`, `npm run build`: passed.
- `npm test`: 137 passed, 15 files.
- `npm run test:property`: three passed, two files.
- `npm run test:e2e`: 16 passed, desktop/mobile.

Tests used permitted child-process/local-server access and disposable synthetic fixtures. No production, provider or desktop access occurred. Hosted SARIF upload and a fresh GitHub run remain unverified until approved publication. No push, PR creation, merge or deployment was performed.

## Install lifecycle-script findings — 2026-10-10

The three SonarCloud S6505 hotspots correctly identify commands that permit install-time lifecycle scripts by default. Added `--ignore-scripts` to the npm bootstrap, locked project installation and SARIF formatter installation in the ESLint workflow. This change is scoped to the scanner job. Explicit `npm run lint` remains available; see [npm's ignore-scripts documentation](https://docs.npmjs.com/cli/v11/commands/npm-ci/#ignore-scripts).

Validation used Node 24.19.0/npm 11.9.0. A pre-edit command check failed because all three installation commands omitted the flag; the same check passed after editing. A disposable, dependency-free package with a synthetic postinstall marker confirmed that normal installation creates the marker and installation with `--ignore-scripts` does not. Both commands ran offline with audit disabled for this fixture.

Executed the repaired install sequence in the isolated worktree: `npm install --global --prefix /tmp/langlo-ci-npm --cache /tmp/langlo-npm-cache --ignore-scripts npm@11.9.0`, then the installed npm ran `npm ci --ignore-scripts` and `npm install --ignore-scripts --no-save --package-lock=false @microsoft/eslint-formatter-sarif@3.1.0` with the same cache. The disposable npm prefix is the only difference from CI's bootstrap destination. All three passed; audit reported zero findings in this run, while the previously recorded results above remain historical.

`npm run lint -- --format @microsoft/eslint-formatter-sarif --output-file /tmp/langlo-ci-eslint-no-scripts.sarif` passed and generated SARIF 2.1.0 with zero findings. `npm run check` reported zero errors/warnings; `npm run format:check` and `git diff --check` passed. No dependency or lockfile changes occurred. The full unit/browser suite was not repeated for this three-command scanner change; earlier full validation is recorded above. Hosted scan/hotspot acceptance and publication remain pending owner approval.

## Coverage across branches and review follow-up — 2026-10-10

Remote branch inventory: main `d6e7a46`, dev `ff1ad1d`, T003 `65d18ff`, CI repair `ee21e75`. Main's ESLint workflow still had the old install commands; main/dev/T003 Quality still installed packages with lifecycle scripts enabled. Extended `--ignore-scripts` to Quality's npm bootstrap and `npm ci`, and removed Quality/ESLint push and PR branch filters. These workflows now cover any branch when their updated files are present. Added the policy to AGENTS.md. This is an explicit expansion requested by the owner; it does not authorize updating remote branches or merging PRs.

The pre-edit install/branch-coverage check failed on Quality's install commands. Post-edit checks passed for both workflows: every install command has the flag and neither workflow filters branches. Validated Node 24.19.0/npm 11.9.0 with `/tmp/langlo-ci-npm/bin/npm ci --ignore-scripts --cache /tmp/langlo-npm-cache` followed by `npm run check`, `npm run lint`, `npm run format:check`, `npm test`, `npm run test:property`, `npm run build`, and `npm run test:e2e`:

| Checkout                                               | Unit tests | Property tests | Browser tests | Other checks |
| ------------------------------------------------------ | ---------- | -------------- | ------------- | ------------ |
| Main-based CI repair, isolated worktree                | 137 passed | 3 passed       | 16 passed     | All passed   |
| Dev ff1ad1d, disposable detached worktree              | 121 passed | 3 passed       | 16 passed     | All passed   |
| T003 65d18ff plus preserved local storage/AGENTS edits | 184 passed | 3 passed       | 16 passed     | All passed   |

All three clean installations passed and reported four moderate audit findings. No package/lockfile or application changes were made by this follow-up. Only synthetic fixtures were used. Existing local T003 work was preserved; its result is not a claim about a clean remote T003 commit. Branch propagation requires approved integration into main, dev and existing feature branches; the remote branches still retain their current files.

The latest published PR #7 head ee21e75 now passes SonarCloud, Run eslint scanning, foundation, OSSAR-Scan and Semgrep. The pasted review's Sonar failure is stale for this head. Its other observations were validated: scanner `continue-on-error: true` is inherited and remains intentional for SARIF reporting, while Quality's separate lint command blocks failures; OSSAR checkout was unpinned and is now aligned to the reviewed SHA with credential persistence disabled. The PR is not draft; a corrected description is prepared locally and awaits owner approval with publication. No merge is authorized. New all-branch workflow checks and the OSSAR checkout change require fresh hosted validation after publication.

## 2026-10-14 · SARIF formatter install isolated (PR 28)

The ESLint scan went red on `main` (`dfcdd2d`) and on PR 28 before ESLint ran. `npm install --no-save --package-lock=false @microsoft/eslint-formatter-sarif@3.1.0` in the project ignores the lockfile, so npm re-resolved the whole tree. It picked `@better-auth/core@1.7.8`, whose peers clash with `@better-auth/drizzle-adapter@1.7.7`, and failed with `ERESOLVE`. This reproduced locally. The workflow now installs the formatter with `--prefix "$RUNNER_TEMP/sarif" --ignore-scripts` and passes ESLint the formatter's file path, so the project tree is never re-resolved. Locally, the prefixed install and `npm run lint -- --format <prefix>/node_modules/@microsoft/eslint-formatter-sarif/sarif.js --output-file <tmp>` both passed and produced SARIF. No dependency or lockfile changes. Whether the hosted scan passes is confirmed only by the CI run.
