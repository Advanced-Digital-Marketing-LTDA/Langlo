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
