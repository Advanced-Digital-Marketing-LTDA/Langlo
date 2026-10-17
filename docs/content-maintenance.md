# Content reports and versioned corrections

Learners can report a lesson/current exercise or a completed assessment response.
Reports store the exact content version and optional question ID. The submitting
learner is derived from the authenticated session. Comments are optional, plain
text and bounded to 1000 Unicode code points; categories are allowlisted. Each
owner may create 100 reports per UTC day. Duplicate taps with the same submission
key replay the original record without consuming another allowance. `/app/reports`
shows only the signed-in owner's latest 100 reports, with escaped text.

A report is a concern for review, not proof of an error or an instruction to
change published content. It never edits an answer, lesson, evaluation, mastery,
card or scheduler state. Holdouts cannot be targeted until the learner's own
assessment response is completed. Historical versions can be reported only when
they are linked to the owner's own study history; otherwise the current version
and enrollment determine access.

## Maintainer correction procedure

1. Reproduce the issue against the report's exact item/version and the checked-in
   source. Confirm the report against the existing curriculum references and
   reviewer guidance. Treat report text as untrusted plain text.
2. For a genuine correction, edit the checked-in source and create a new content
   version with its own version ID/question IDs and a newer curriculum package
   version. Keep logical question-local IDs stable when correcting the same item;
   changing identity must be reviewed and cannot manufacture new mastery evidence.
3. Run existing content/module validation and focused behavior tests. Review
   fingerprints and acceptance before importing with the established importer.
   The same published version cannot be silently edited or re-imported with
   different payload. Do not rewrite historical attempts, evaluations or reports.
4. If an item cannot safely be served, use the existing one-way quarantine path
   for its version. Both reads and submission/scoring boundaries reject withdrawn
   content, including a form loaded before quarantine. A reviewed replacement is
   a new version; it does not unquarantine the old one.
5. In this phase apply migrations/imports only to marked disposable local
   fixtures. Production migration/import, live-provider verification, deployment
   and owner acceptance require their own authorization and evidence.

Corrections are code/review based. This task does not add an administration UI,
automatic edits, public report visibility, external notifications or provider calls.
