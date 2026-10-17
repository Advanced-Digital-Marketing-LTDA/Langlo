# LANGLO-44–47 coverage improvement

Plan before test changes, 2026-10-17. Continue on PR #94 from `27a9229`.
The owner requested increased coverage of the new files. Application behavior,
coverage thresholds/configuration, dependencies and unrelated tests stay unchanged.

1. Run the existing CI coverage command with additional JSON output under `/tmp`.
   Measure newly added runtime files against `origin/main` and identify untested
   branches/functions, distinguishing browser evidence from Vitest instrumentation.
2. Add real-fixture route/action tests for assessment creation, submission,
   resume, results, reports, authentication and owner isolation. Verify responses,
   redirects, persisted answers and zero-write rejection, not mocked call counts.
3. Add focused tests for uncovered assessment planning/answer validation,
   evaluator selection, report access/normalization, progress filtering and
   recommendation cases. Every test should catch a plausible wrong branch or
   missing side effect; avoid tests of prose, constants or forwarding alone.
4. Rerun coverage and compare the same new runtime files. Use disposable local
   synthetic fixtures and fake provider boundaries only. Record exact before/after
   counts and any remaining gaps in `docs/evidence/LANGLO-44-47-coverage.md`.
5. Run required validation, inspect the test-only diff, then commit and push the
   improvement to the existing PR. Verify the remote head and report hosted
   coverage separately when available. Do not change gates to improve a number.

Validation follow-up: the combined four-format practice, assessment, progress and
report browser journey twice exhausted its inherited 20-second test budget after
reaching progress without a failed assertion. Give only this extended test 40
seconds and retain all assertions; leave global browser timeouts unchanged.
