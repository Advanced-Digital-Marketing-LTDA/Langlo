# Updating content that is already imported

Imported content is immutable. A correction is a new lesson version of the same skill, imported under a newer curriculum version. What a learner already answered is never edited or deleted; the rules below decide what still counts toward mastery. The importer (`src/lib/server/content-import.ts` and `content-update.ts`) enforces them and fails loudly.

## Authoring an edit

1. Create the next version of the skill (`skill@N+1`) with its own question ids. The earlier version stays untouched. A version lower than one already stored for the skill fails with `VERSION_ORDER`.
2. Every question of that version declares `change`:
   - `same`: the question keeps its meaning (a wording fix). It also names the earlier question it continues in `continues`, which must belong to the immediately earlier version, and no earlier question may be continued twice.
   - `changed`: the question has a new meaning, whatever its number.
   - `new`: the question did not exist before.

   A question of the earlier version that no `same` continues is removed. Never reuse a question number for a different meaning without marking it `changed`.

3. A skill's first version carries no declarations; declaring one there is refused.
4. Raise `curriculum_version` in `content/curriculum-manifest.json` by hand. The importer never increments it. It checks that the bump matches the changes it finds:

   | Bump  | Needed when the import contains                                                                                        |
   | ----- | ---------------------------------------------------------------------------------------------------------------------- |
   | patch | only `same` questions and no removal, or a version quarantined                                                         |
   | minor | a new skill, new prerequisites, a new first version, a lesson translation, or any `changed`, `new` or removed question |
   | major | a retired skill                                                                                                        |

   A package that changes no rows (a reissued bundle) may take any newer version. A wrong bump fails with `VERSION_BUMP`.

5. Run `npm run content:import` (dry run), then `npm run content:import -- --impact --confirm-host HOST` against the target database. The impact report is read-only and lists, per skill, the answers that mastery counts today and would stop counting (same rules as mastery: the first response to an item, independent, evaluated correct or incorrect). Applying is an owner action.

## What counts toward mastery

- Each question has a lineage key. A `same` question inherits the key of the question it continues; a `changed` or `new` question gets its own id as key; rows imported before lineage keys behave as before (the key is the question number after the version prefix).
- Mastery counts the first independent answer per lineage key, and only for keys present in the skill's current version (its newest version that is not quarantined). An answer to a changed or removed question stays stored but stops counting; the learner's first answer to the new item counts.
- If the newest version is quarantined, the previous version is current again and its answers count again. New assessments are planned from that version too.
- Assessments treat an item as already answered by lineage key too, so a changed holdout is offered again.

## Retiring or replacing a skill

A package lists `retirements` (`skillId`, optional `replacedBy`, optional `carry`). A retired skill leaves the catalog, recommendations and new assessments; its history stays stored. Answers do not move to the replacement unless the owner approved `carry: true` for a pure rename (same content under a new id): then the retired skill's answers count for the replacement where the lineage keys match. A carry must land on a skill that is not retired, so carries cannot loop. Retirement needs a major bump and cannot be undone by the importer.

## What a learner sees

A session keeps the version of its first answer for a skill, so a half-finished lesson or session finishes on the questions it started. A tab holding a question from another version gets `STALE_QUESTION`; a withdrawn version gets `CONTENT_UNAVAILABLE`. The lesson page of a session on an earlier version says the lesson was updated and that the next session uses the new one.

## Grammar retention schedules

A learner's grammar retention schedule for a skill always carries over to the skill's newest published version: recall state, due date and review history stay as they are, whether the new version only fixes wording or adds, changes or removes questions. Publishing a version (by insert or by a status change) moves the schedules to it; an older version approved after a newer one moves nothing. Both are triggers on `content_versions` (migration 0031). The same migration also restores schedules that the earlier reset triggers had marked for reset, taking the due date back from the recall state they still store; it stops if such a row has no readable due date.

## Record and reversal

Each import writes `content_changes` rows (skills added or retired, versions added or quarantined, lesson translations added, questions same, changed, new or removed) in its own transaction. Adding a translation to an already-stored lesson is logged as `lesson-translation-added` and requires a minor curriculum bump. Nothing learner-side is rewritten, so mastery is recomputed on every read and there is nothing to restore. To reverse an update, publish a newer version that restores the content under new question ids with the matching declarations. Quarantine withdraws a version and is logged as `version-quarantined`; the newest version that is not quarantined is then what lessons, the mastery catalog, the update notice, assessments and mastery use, and the quarantined version stays readable in `content_versions` and `content_changes`.

## Production runbook (owner)

1. Confirm all migrations are applied (`node scripts/db-remote-test.ts status` shows `pending: 0`); 0016 adds the lineage, retirement and change-log columns, and 0017 adds lesson translations.
2. Back up the database.
3. Dry run, then the impact report, then review the report.
4. Apply with `--apply --confirm-host HOST`.
5. A database that already holds the bundle under `1.0.0` rejects a changed package under that same version. The translation bundle is `1.1.0`; the production ledger was previously reported to hold `1.0.0`, so verify its migration state and impact report before any live apply.
