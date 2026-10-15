# CI APKG feasibility tests — 2026-10-15

## Gap

The Quality workflow ran every Node check but never the Python T003 suites (`tests/test_t003_apkg.py`, `tests/test_t003_paths.py`). A regression in the APKG generator, its independent checker or its output-path guard could merge unnoticed.

## Change

New `apkg-feasibility` job in `.github/workflows/ci.yml`, on every push and pull request with read-only permissions and no secrets. It creates a throwaway venv under `$RUNNER_TEMP`, installs pinned genanki 0.13.1 and its four dependencies as wheels only (`--only-binary=:all: --no-deps`, the pip analogue of `--ignore-scripts`: no sdist build code runs), then runs `python -m unittest discover -s tests -p 'test_t003_*.py' -v`. `tests/test_t003_apkg.py` and `tests/test_t003_paths.py`, the checker and generator test twins, are now listed explicitly in CODEOWNERS.

## Local evidence (Python 3.13, same commands as the job)

- Green: `Ran 6 tests … OK`, exit 0.
- Empty discovery (`-p 'test_nomatch_*.py'`): `NO TESTS RAN`, exit 5, so the job fails with no tests.
- Red: temporarily inverting the byte-determinism assertion in `tests/test_t003_apkg.py` gave `FAILED (failures=1)`, exit 1. Reverted.
- `prettier --check .github/workflows/ci.yml` passed; the workflow parses with jobs `foundation`, `apkg-feasibility`, `merge-evidence-gate`.

## Pending

A hosted GitHub run of the new job is unverified until the PR's CI runs. Exports go to child directories of the system temp root, per the accepted T003 policy.

## Adversarial review workflow — owner-approved 2026-10-15

Andrew chose adversarial-review (npm 2.11.1, published 2026-10-06) as the one paid AI PR reviewer. `.github/workflows/adversarial-review.yml` runs on pull requests from this repository only (fork PRs are skipped), with read-only permissions. The tool is installed outside the project tree with `--ignore-scripts` and run with `--provider anthropic --fail-on high --fail-on-empty`, so high-severity findings fail the check. Every step after the first is skipped, with a notice, until an `ANTHROPIC_API_KEY` secret exists. AGENTS.md records this as the only allowed provider call.

Local evidence: the pinned install succeeded, and `--prompt-only` against `origin/main` built the prompt with exit 0 and no model call. Without a key, the real run failed closed with exit 1 (Anthropic 404), which is why the workflow guards every step on the secret. No provider call succeeded locally. A hosted run that makes a real call is pending until the secret is added.
