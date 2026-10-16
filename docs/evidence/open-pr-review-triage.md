# Open PR review and local repairs · 2026-10-16

## Scope and delivery

Owner approved the listed local repair scope in this Codex conversation on 2026-10-16.
Reviewed all 32 open PRs (#45–#76), including 121 unresolved threads at the heads below.
All thread lists fit within the requested 100-thread pages; no thread or comment pagination was truncated.
The curriculum stack tip is `b491914215856e77a9666e2347d818a54dcb86b1` (#76).
The local repair branch contains that complete stack plus #46's documentation file
from `ab0b03eaf8050377818c299558ead064b926c9e1`. Repairs are consolidated locally;
this is not a claim that 32 GitHub branches were updated. No push, merge, comment,
thread resolution, CI trigger, deployment, provider call or real database access occurred.

Source checkout: `/var/home/user/Documents/Langlo` (main, unchanged).
Isolated repair checkout: `/var/home/user/Documents/Langlo/.superpowers/open-pr-review-20261016`.
Branch: `codex/open-pr-review-20261016`.

## Observed validation

Commands used Node `24.19.0` and npm `11.9.0`. The environment default npm
was `11.16.0`, so validation invoked the pinned executable through
`npm exec --yes --package=npm@11.9.0 -- npm ...` with a disposable cache.
`npm ci --ignore-scripts` installed 280 packages, audited 281, and reported
0 vulnerabilities; required validation ran explicitly afterwards.

| Check                                          | Observed result                               |
| ---------------------------------------------- | --------------------------------------------- |
| Clean original stack baseline: npm test        | 717/717 passed, 40 files                      |
| npm run check                                  | 0 errors, 0 warnings                          |
| npm run lint                                   | exit 0                                        |
| npm run format:check                           | all matched files formatted                   |
| npm test after repairs                         | 753/753 passed, 40 files, no skipped tests    |
| npm run test:property                          | 5/5 passed, 4 files                           |
| npm run validate:curriculum                    | 125 records, 164 edges, approved bundle 1.0.0 |
| npm run build                                  | exit 0                                        |
| npm run test:e2e against the built Node server | 72 passed, desktop and mobile, 29.9 seconds   |
| git diff --check                               | exit 0                                        |

The full ordinary suite includes properties and still fails when no tests are
collected. Existing SvelteKit error-body deprecation messages remain in the
logs; no application code was changed for those unrelated warnings.

Observed test-first failure before the content repairs:

```text
 Test Files  1 failed (1)
      Tests  36 failed | 249 passed (285)
```

The failures include 33 incorrect answer acceptances, the ambiguous-cue group,
the dative-scope group, and an explanation copying a typed assessment answer.
After the corresponding minimal repairs:

```text
 Test Files  1 passed (1)
      Tests  285 passed (285)
```

Removing explicit approval overrides before adding the fixture's default
produced 31 `UNREVIEWED` import failures. After defaulting to the module's
status, both curriculum suites passed together:

```text
 Test Files  2 passed (2)
      Tests  296 passed (296)
```

Mutation probes made a French example German-only, a German example French-only,
added a whitespace-only multiple-choice option, and copied `Marie travaille.`
from French module 01 into a module 02 holdout. All four were incorrectly accepted
by the original checks (exit 0); all four are rejected by the repaired checks
(exit 1). The broader track check also found the existing `Ils travaillent
aujourd'hui ?` overlap, which was replaced with a new held-out sentence.
Temporary duplicate-ID, duplicate-prompt and pending-status probes verify the
shared assertion and status behavior. Every mutated file was restored.

Each of the 31 newly added modules also received an isolated count mutation:
set the first practice item's `holdout` flag to true, select its count test,
observe exit 1 with `expected 11 to be 12`, and restore the file. All 31 probes
failed for that expected reason. These are current synthetic audit probes;
they do not reconstruct the original authoring red run.

The full final runs produced:

```text
 Test Files  40 passed (40)
      Tests  753 passed (753)

 Test Files  4 passed (4)
      Tests  5 passed (5)

  72 passed (29.9s)
```

The local validator did not receive a previous registry snapshot, so it reports
that it starts registry history; this does not prove cross-version ID retention.
The GitHub snapshot and complete command/probe logs are retained locally in
`/var/home/user/Documents/Langlo/.superpowers/open-pr-review-artifacts-20261016`.
No original authoring output was reconstructed.

## Decisions and limits

- Existing `review_status` values and historical owner-waiver statements are preserved.
  The earlier waiver is an author-recorded external claim; this repair task neither
  independently verifies it nor supplies specialist review, CODEOWNER approval or release acceptance.
- LANGLO-125 remains a release blocker: the importer drops the holdout distinction,
  and the questions table does not store prompts or answers. No schema/runtime fix is authorized here.
- `accepts` and `normalize` exercise the test-local curriculum contract, not a deployed
  server-side evaluator. Case and final punctuation remain ignored; accents, internal
  punctuation, and inserted or missing apostrophes count. Prototype matching is separate.
- T101 explicitly allows words to recur among multiple-choice options. Glossaries,
  conjugation tables and guided practice may teach or reuse vocabulary. These are not
  automatically assessment leaks. Complete assessment sentences are checked against
  practice across the same track; typed held-out sentences are also checked against explanations.
- No content version was imported anywhere except disposable synthetic fixtures.
  The curriculum manifest, skill catalog, runtime, migrations, dependency lockfile and
  workflow limits are unchanged.

## Language references used to assess disputed comments

- [Cambridge: hate, like, love and prefer](https://dictionary.cambridge.org/uk/grammar/british-grammar/hate-like): supports both -ing and to-infinitive after these verbs.
- [UT Austin: indefinite articles, professions](https://www.laits.utexas.edu/tex/gr/det4.html): profession statements after etre omit the article in the taught construction. The two proposed bare profession article alternatives in #51 were not adopted as a general A1 model.
- The existing matching contract and T101's explicit option-reuse exception are local source decisions, not inferred policy changes.

## Hosted checks observed before repair

- #45 SonarCloud: 9.7% duplication on new code (limit 3%). The public duplications API
  identified repeated uniqueness assertions (11-line block) and import-fixture setup
  (25-line block) between the two curriculum suites. Shared helpers remove those copies.
  Local edits do not prove a new SonarCloud result.
- #55 foundation, run `38933221845`, job `117082147397`: 548/549 tests passed;
  fixture migration subprocess was killed after 5111 ms. The clean local baseline and
  final full suite are separate evidence. No timeout was raised, test weakened or CI rerun.
- #55 Claude review, run `38941110566`: action reported success after 33 turns,
  exceeding its maximum of 30, with 23 permission denials.
- #59 Claude review, run `38941126621`: action reported success after 32 turns,
  exceeding its maximum of 30, with 16 permission denials.
- Other listed checks had no failures in the initial inventory. Gate comments may
  still say NEEDS_HUMAN independently of a successful check conclusion.
- Codacy Cloud lookup for #45 returned Not Found. Local strict Codacy analysis returned
  MissingConfig with an empty toolResults list. This is unavailable analysis, not a clean scan.

## Review layers

Manual foreground review covers the test-analysis, silent-failure, code-review and
fixture-type concerns in the ledger below. The installed PR Review Toolkit agents
were not available as callable tools in this session; this does not count as execution
of that plugin. No gstack cso/test-audit skills or Warp CLI were found. These named
external review layers remain unexecuted. Local adversarial review and CI AI reviews
were not invoked: this task did not authorize provider calls. No PR is being opened or pushed.

## PR head inventory

| PR                                                                       | Base                           | Head                                       | Title                                                                                |
| ------------------------------------------------------------------------ | ------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| [#45](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/45) | `main`                         | `5c8945085e18ca7130eb3d01a5754f493a2cdf9e` | Add French A1 module 02                                                              |
| [#46](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/46) | `main`                         | `ab0b03eaf8050377818c299558ead064b926c9e1` | Document shared workflow trust and pinning                                           |
| [#47](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/47) | `claude/project-thread-msujgr` | `80d49243d7cd3d07c63de86487ef058f050d4f15` | Add French A1 module 03                                                              |
| [#48](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/48) | `claude/fr-a1-module-03`       | `0b3b37598d7fd92d32cf7acad64f887b88818f64` | Add French A1 module 04                                                              |
| [#49](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/49) | `claude/fr-a1-module-04`       | `4f02a1fdab0f81c5e5403ed919896f5d5e076414` | Add French A1 module 05                                                              |
| [#50](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/50) | `claude/fr-a1-module-05`       | `20a56eb39c02ac0fe93968a00da47edd65773b28` | Add French A1 module 06                                                              |
| [#51](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/51) | `claude/fr-a1-module-06`       | `23ead66054779279b945cca11744879d05f46cdf` | Add French A1 module 07 (il faut, polite requests, professions, être en train de)    |
| [#52](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/52) | `claude/fr-a1-module-07`       | `1857ebc2319c44a0d9d91cbb38b2d8886d6ea478` | Add German A1 module 01 (sentence order, questions, present tense)                   |
| [#53](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/53) | `claude/de-a1-module-01`       | `7b655068324d45d8dba93a02d40b2c2c4a1b6a29` | Add German A1 module 02 (irregular verbs, noun gender, plurals, articles)            |
| [#54](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/54) | `claude/de-a1-module-02`       | `0cdd47a282fa8322cff7464389780ecddc6b84b1` | Add German A1 module 03 (negation, cases, pronouns, modal verbs)                     |
| [#55](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/55) | `claude/de-a1-module-03`       | `c40febdff28010ad774b93d482c01cfe91d38d37` | Add German A1 module 04 (dative, possessives, demonstratives)                        |
| [#56](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/56) | `claude/de-a1-module-04`       | `b3ec97c27baf4d17995600fa46f5b46ceb2d03ff` | Add German A1 module 05 (separable verbs, past tenses, imperatives)                  |
| [#57](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/57) | `claude/de-a1-module-05`       | `67f1f659c7265ca46a73636281c608ce4523acf3` | Add German A1 module 06 (polite requests, adjectives, prepositions, connectors)      |
| [#58](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/58) | `claude/de-a1-module-06`       | `76a12a9bf802f81f9a5894765e44e94d02e68338` | Add German A1 module 07 (kein, time expressions, nicht)                              |
| [#59](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/59) | `claude/de-a1-module-07`       | `8b348bf4abdf3c085a39e583710b115d9d00ee95` | Add German A2 module 01 (past tenses, separable verbs, sentence bracket)             |
| [#60](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/60) | `claude/de-a2-module-01`       | `934db965ecfa0302cbdf3e759f97709c6088dbc1` | Add German A2 module 02 (weil, dass, embedded questions, case patterns)              |
| [#61](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/61) | `claude/de-a2-module-02`       | `1f020ca27cd0b1e2d7d9cbee722847b6814213fc` | Add German A2 module 03 (two-way prepositions, pronouns, reflexives, possessives)    |
| [#62](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/62) | `claude/de-a2-module-03`       | `15d0fb4aad2081d0820442cb33d92977e13ab213` | Add German A2 module 04 (determiners, adjectives, comparison, quantity)              |
| [#63](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/63) | `claude/de-a2-module-04`       | `7ce86a99e3a2e35649e7bbf5066e0cbe26250295` | Add German A2 module 05 (prepositions, connectors, zu + infinitive)                  |
| [#64](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/64) | `claude/de-a2-module-05`       | `26696d70d2b1c359e93e7c8c5248de93a6750a33` | Add German A2 module 06 (future, imperatives, preference, possession)                |
| [#65](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/65) | `claude/de-a2-module-06`       | `1f95bf76801ec1a0a4e9646c5ec057f11bdffeba` | Add English A1 module 01 (statements, be, present tenses)                            |
| [#66](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/66) | `claude/en-a1-module-01`       | `d6bd73dee2a079ad37cff9a4a9ce2c12ad825297` | Add English A1 module 02 (past simple, questions, negatives)                         |
| [#67](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/67) | `claude/en-a1-module-02`       | `33fc87ab2418f1efbb0997cd6c979621582ecc6d` | Add English A1 module 03 (plurals, articles, pronouns, possessives)                  |
| [#68](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/68) | `claude/en-a1-module-03`       | `8a19226b114eb657e18dbc8eb4bc7aecd7b8fc80` | Add English A1 module 04 (some and any, adjectives, adverbs, prepositions)           |
| [#69](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/69) | `claude/en-a1-module-04`       | `0e02ce7458f700143bf7a64065e3dd4b17059fe8` | Add English A1 module 05 (imperatives, connectors, have got, can)                    |
| [#70](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/70) | `claude/en-a1-module-05`       | `5b73dd3d97b0bb41f99213795d10566f82ce1fd0` | Add English A1 module 06 (there is, want to)                                         |
| [#71](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/71) | `claude/en-a1-module-06`       | `615aca3e9e38f0386bc1942c107464b7a7fb65d5` | Add English A2 module 01: past tenses, present perfect, going to                     |
| [#72](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/72) | `claude/en-a2-module-01`       | `7b7b74c9eec2681d93d1afd68e03254bce42e02c` | Add English A2 module 02: will, arranged plans, could, obligation                    |
| [#73](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/73) | `claude/en-a2-module-02`       | `a94663f86ac802559d79ac633c64ff2c5b802faf` | Add English A2 module 03: advice, to-infinitives, superlatives, adverb comparison    |
| [#74](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/74) | `claude/en-a2-module-03`       | `2d087f103536e99377f8c5fb5e3fc6ac12f54fef` | Add English A2 module 04: relative clauses, connectors, conditional, reported speech |
| [#75](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/75) | `claude/en-a2-module-04`       | `21e4eebe0f56fd224ad8d34eb7d6fd8bd6631e99` | Add English A2 module 05: passives, quantifiers, question tags, adverb position      |
| [#76](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/76) | `claude/en-a2-module-05`       | `b491914215856e77a9666e2347d818a54dcb86b1` | Add English A2 module 06: prepositions, purpose, verb + -ing                         |

## Thread-by-thread disposition

Fixed means fixed in this local repair checkout, not published or resolved on GitHub.

### PR #45

| Finding                                                                                                                                         | Disposition   | Response                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [45.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/45#discussion_r4297526809) · `tests/curriculum-modules.test.ts:104`       | Fixed         | Read only the track-specific example field; French and German corruption probes now fail.                                                                                                                               |
| [45.2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/45#discussion_r4297527194) · `tests/curriculum-modules.test.ts:183`       | Fixed         | Check non-empty alternatives before the multiple-choice early continue.                                                                                                                                                 |
| [45.3](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/45#discussion_r4297527483) · `tests/curriculum-modules.test.ts:149`       | Fixed         | Compare complete holdout sentences with practice and examples across the same track. A French question overlapping module 01 was replaced. Single-word forms may recur; retain the explicit T101 exception for options. |
| [45.4](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/45#discussion_r4297527800) · `tests/curriculum-modules.test.ts:250`       | Fixed         | Default the package builder to module.review_status; test both pending statuses with zero writes and import the declared approved status.                                                                               |
| [45.5](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/45#discussion_r4297528073) · `tests/fixtures/curriculum-module.ts:21`     | Answered      | The example shape supports French, German and English-only objects. Track-specific runtime checks now reject a missing target field. A larger discriminated-union redesign is unnecessary for these JSON fixtures.      |
| [45.6](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/45#discussion_r4297528461) · `tests/fixtures/curriculum-module.ts:45`     | Documented    | The matcher is a test-local content contract, not the runtime grader. This limitation and the runtime task boundary are recorded in every module evidence file.                                                         |
| [45.7](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/45#discussion_r4297528856) · `content/fr-a1/module-02.json:6`             | Pending owner | Preserve existing approval status and recorded waiver. This repair approval does not verify the earlier external waiver or constitute content/release acceptance.                                                       |
| [45.8](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/45#discussion_r4297529149) · `docs/evidence/modules/fr-a1-module-02.md:1` | Fixed         | Record observed audit red/green results and the limits of reconstructed evidence; do not invent the original authoring runs.                                                                                            |
| [45.9](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/45#discussion_r4297529488) · `tests/curriculum-modules.test.ts:1`         | Fixed         | Explicit CODEOWNERS entries cover both suites and their shared verification fixture.                                                                                                                                    |

### PR #46

| Finding                                                                                                                          | Disposition | Response                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [46.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/46#discussion_r4297510976) · `docs/shared-workflows.md:25` | Fixed       | The bump procedure updates tools-ref to the identical uses SHA and checks the checkout; the format check alone does not prove equality. |
| [46.2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/46#discussion_r4297511203) · `docs/shared-workflows.md:5`  | Clarified   | The document explicitly requires separate owner authorization for cross-repository provider calls and grants none itself.               |

### PR #47

| Finding                                                                                                                                         | Disposition   | Response                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [47.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/47#discussion_r4297539148) · `docs/evidence/modules/fr-a1-module-03.md:7` | Fixed         | Distinguish four practice formats from three holdout formats.                                                                                      |
| [47.2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/47#discussion_r4297539434) · `content/fr-a1/module-03.json:6`             | Pending owner | Approval provenance is recorded as unverified; existing statuses remain unchanged.                                                                 |
| [47.3](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/47#discussion_r4297539663) · `docs/evidence/modules/fr-a1-module-03.md:3` | Fixed         | Add current observed validation, negative-probe evidence and pending acceptance. validate:curriculum checks the bundle; Vitest covers module JSON. |

### PR #48

| Finding                                                                                                                                         | Disposition | Response                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------- |
| [48.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/48#discussion_r4297529986) · `content/fr-a1/module-04.json:487`           | Fixed       | Use followed by instead of plus in the clock-time explanation.                                      |
| [48.2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/48#discussion_r4297530244) · `docs/evidence/modules/fr-a1-module-04.md:7` | Fixed       | Correct the holdout-format claim.                                                                   |
| [48.3](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/48#discussion_r4297530667) · `docs/evidence/modules/fr-a1-module-04.md:3` | Fixed       | Record current observed checks and negative probes without claiming historical test-first evidence. |

### PR #49

| Finding                                                                                                                               | Disposition | Response                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [49.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/49#discussion_r4297577521) · `content/fr-a1/module-05.json:409` | Fixed       | Near-future translations explicitly request aller + infinitive.                                                                                         |
| [49.2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/49#discussion_r4297577750) · `content/fr-a1/module-05.json:134` | Fixed       | Keep the subject while permitting correction of verb agreement.                                                                                         |
| [49.3](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/49#discussion_r4297577952) · `content/fr-a1/module-05.json:6`   | Fixed       | Shared fixture import tests now pass the module status; JSON metadata is not represented as a runtime gate.                                             |
| [49.4](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/49#discussion_r4297578115) · `content/fr-a1/module-05.json:322` | Answered    | A vocabulary recall question may test a word taught in the lesson. Removing its gloss would reduce instruction, and no rule requires unseen vocabulary. |
| [49.5](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/49#discussion_r4297578762) · `content/fr-a1/module-05.json:486` | Answered    | Retain connector definitions and recall items. This is taught vocabulary, not a copied complete assessment sentence.                                    |

### PR #50

| Finding                                                                                                                               | Disposition | Response                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [50.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/50#discussion_r4297539580) · `content/fr-a1/module-06.json:111` | Fixed       | Accept the cited word-order and digit variants; matching normalization itself is unchanged.                                           |
| [50.2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/50#discussion_r4297539864) · `content/fr-a1/module-06.json:474` | Answered    | T101 explicitly excludes multiple-choice distractors from comparison because frequent words legitimately recur. Preserve that policy. |

### PR #51

| Finding                                                                                                                                         | Disposition | Response                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [51.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/51#discussion_r4297528992) · `content/fr-a1/module-07.json:448`           | Answered    | Do not accept the proposed bare profession article form as the general A1 model. UT Austin teaches omission after etre for profession statements; keep the existing intended standard form. Specialist acceptance remains pending. |
| [51.2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/51#discussion_r4297529225) · `content/fr-a1/module-07.json:503`           | Answered    | The same profession rule applies to the baker holdout; no unsupported alternative was added.                                                                                                                                       |
| [51.3](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/51#discussion_r4297529480) · `content/fr-a1/module-07.json:378`           | Fixed       | Add DELF-A1-ADULT to lesson 027 references. Lesson 026 already has both catalog references.                                                                                                                                        |
| [51.4](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/51#discussion_r4297529721) · `docs/evidence/modules/fr-a1-module-07.md:3` | Fixed       | Correct the scope claim and link current observed evidence.                                                                                                                                                                        |

### PR #52

| Finding                                                                                                                                          | Disposition   | Response                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [52.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/52#discussion_r4297537383) · `content/de-a1/module-01.json:108`            | Fixed         | Accept In Bonn arbeitet Anna.                                                                                                                             |
| [52.2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/52#discussion_r4297537661) · `content/de-a1/module-01.json:116`            | Fixed         | Accept Paul lernt morgen Deutsch.                                                                                                                         |
| [52.3](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/52#discussion_r4297537891) · `content/de-a1/module-01.json:307`            | Answered      | The accepted contract ignores final punctuation; changing it here would change matching policy. Verb-first word order is still checked. Record the limit. |
| [52.4](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/52#discussion_r4297538158) · `docs/evidence/modules/de-a1-module-01.md:3`  | Fixed         | Correct the evidence scope and record current verification; unavailable external review tools are named.                                                  |
| [52.5](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/52#discussion_r4297538387) · `docs/evidence/modules/de-a1-module-01.md:13` | Pending owner | Preserve the historical waiver claim and mark independent approval provenance and release acceptance pending.                                             |

### PR #53

| Finding                                                                                                                                         | Disposition | Response                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| [53.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/53#discussion_r4297539608) · `content/de-a1/module-02.json:6`             | Documented  | Every module evidence file explicitly carries the LANGLO-125 release blocker; content approval is distinct from release. |
| [53.2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/53#discussion_r4297539833) · `content/de-a1/module-02.json:158`           | Fixed       | Limit the always die claim to the nominative plural in lessons 007 and 008.                                              |
| [53.3](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/53#discussion_r4297540038) · `content/de-a1/module-02.json:124`           | Answered    | Guided practice can reuse lesson examples; clarify the originality claim instead of redesigning all practice.            |
| [53.4](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/53#discussion_r4297540286) · `docs/evidence/modules/de-a1-module-02.md:3` | Fixed       | List actual skill IDs rather than a misleading contiguous range.                                                         |

### PR #54

| Finding                                                                                                                                         | Disposition   | Response                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [54.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/54#discussion_r4297525424) · `content/de-a1/module-03.json:6`             | Pending owner | Preserve approval status; mark the external waiver as not independently verified.                                      |
| [54.2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/54#discussion_r4297525588) · `content/de-a1/module-03.json:452`           | Answered      | Pronoun recall requires teaching the pronoun forms. There is no requirement to withhold those words from explanations. |
| [54.3](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/54#discussion_r4297525776) · `content/de-a1/module-03.json:621`           | Answered      | The same reasoning applies to the modal conjugation recall item.                                                       |
| [54.4](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/54#discussion_r4297525962) · `docs/evidence/modules/de-a1-module-03.md:3` | Fixed         | Correct the scope description and record current observed validation.                                                  |

### PR #55

| Finding                                                                                                                                         | Disposition | Response                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [55.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/55#discussion_r4297584260) · `docs/evidence/modules/de-a1-module-04.md:9` | Documented  | Carry LANGLO-125 forward as a release blocker.                                                                                  |
| [55.2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/55#discussion_r4297584548) · `content/de-a1/module-04.json:12`            | Fixed       | Keep dative teaching and recognition items within mit, helfen, gehoren and gefallen frames, without teaching the full paradigm. |
| [55.3](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/55#discussion_r4297584793) · `docs/evidence/modules/de-a1-module-04.md:3` | Fixed       | Add current observed validation and negative probes.                                                                            |

### PR #56

| Finding                                                                                                                                         | Disposition   | Response                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [56.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/56#discussion_r4297546639) · `content/de-a1/module-05.json:6`             | Pending owner | The high-severity approval concern is an acceptance/provenance question. Preserve the approved edit scope, do not manufacture an owner review, and keep release blocked.                      |
| [56.2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/56#discussion_r4297546910) · `docs/evidence/modules/de-a1-module-05.md:3` | Fixed         | Correct the scope claim and record current observed checks.                                                                                                                                   |
| [56.3](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/56#discussion_r4297547180) · `content/de-a1/module-05.json:12`            | Fixed         | The conjugated verb, not the stem, takes second position.                                                                                                                                     |
| [56.4](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/56#discussion_r4297547456) · `content/de-a1/module-05.json:10`            | Answered      | Current module IDs were checked as de-a1-017 through 020 with 4 lessons and 60 items. No current omission or swap exists; avoid a new module-specific suite solely for a hypothetical change. |

### PR #57

| Finding                                                                                                                                         | Disposition   | Response                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [57.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/57#discussion_r4297538496) · `content/de-a1/module-06.json:92`            | Fixed         | Accept gerne alongside gern in the typed blank.                                                                            |
| [57.2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/57#discussion_r4297538735) · `content/de-a1/module-06.json:12`            | Answered      | Retain explicitly taught modal and adjective vocabulary; recall of a taught word is not a duplicated full assessment item. |
| [57.3](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/57#discussion_r4297538980) · `content/de-a1/module-06.json:6`             | Pending owner | Approval provenance and specialist acceptance remain pending; no status was rewritten.                                     |
| [57.4](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/57#discussion_r4297539236) · `docs/evidence/modules/de-a1-module-06.md:3` | Fixed         | Record observed audit validation and the original-evidence limitation.                                                     |

### PR #58

| Finding                                                                                                                                         | Disposition   | Response                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [58.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/58#discussion_r4297572754) · `content/de-a1/module-07.json:6`             | Pending owner | No additional verifiable waiver source was available in GitHub. Preserve the historical claim, explicitly qualify its provenance and keep release pending. |
| [58.2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/58#discussion_r4297573044) · `content/de-a1/module-07.json:7`             | Documented    | The matcher remains a test-local contract; runtime implementation is out of this repair scope.                                                             |
| [58.3](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/58#discussion_r4297573289) · `docs/evidence/modules/de-a1-module-07.md:9` | Fixed         | Record the content prerequisite de-a1-023 for de-a1-026 as well as the shared-test dependency.                                                             |
| [58.4](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/58#discussion_r4297573611) · `docs/evidence/modules/de-a1-module-07.md:3` | Fixed         | Record current checks, negative probes and pending acceptance.                                                                                             |

### PR #59

| Finding                                                                                                                                         | Disposition   | Response                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [59.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/59#discussion_r4297550947) · `content/de-a2/module-01.json:6`             | Pending owner | Preserve status and qualify unverified approval provenance.                                                                                                 |
| [59.2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/59#discussion_r4297551147) · `content/de-a2/module-01.json:12`            | Answered      | Participle and conjugation forms must be taught. Recall of taught vocabulary alone is not a holdout violation; this suite guards copied complete sentences. |
| [59.3](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/59#discussion_r4297551375) · `content/de-a2/module-01.json:239`           | Fixed         | Add explicit past-time cues to mussten and hatte blanks.                                                                                                    |
| [59.4](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/59#discussion_r4297551636) · `content/de-a2/module-01.json:91`            | Answered      | Preserve guided practice reuse and clarify the evidence claim.                                                                                              |
| [59.5](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/59#discussion_r4297551880) · `content/de-a2/module-01.json:7`             | Answered      | Case-insensitivity is an explicit existing policy; changing German spelling assessment requires an owner decision outside this scope.                       |
| [59.6](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/59#discussion_r4297552064) · `docs/evidence/modules/de-a2-module-01.md:7` | Fixed         | Correct the practice-versus-holdout format description.                                                                                                     |

### PR #60

| Finding                                                                                                                               | Disposition | Response                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------- |
| [60.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/60#discussion_r4297588366) · `content/de-a2/module-02.json:286` | Fixed       | Use the unambiguously singular Anna rather than sie in the kommt blank. |
| [60.2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/60#discussion_r4297588576) · `content/de-a2/module-02.json:124` | Fixed       | Accept lebt in the weil translation.                                    |
| [60.3](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/60#discussion_r4297588762) · `content/de-a2/module-02.json:293` | Fixed       | Accept lebt in the dass translation.                                    |
| [60.4](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/60#discussion_r4297588959) · `content/de-a2/module-02.json:315` | Fixed       | Accept glaube alongside denke.                                          |
| [60.5](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/60#discussion_r4297589119) · `content/de-a2/module-02.json:499` | Fixed       | Accept beginnt alongside anfangt in the cited course-start item.        |

### PR #61

| Finding                                                                                                                               | Disposition | Response                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| [61.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/61#discussion_r4297599459) · `content/de-a2/module-03.json:295` | Fixed       | Accept geben alongside schenken.                                                                                    |
| [61.2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/61#discussion_r4297599718) · `content/de-a2/module-03.json:442` | Fixed       | Accept the digit 8 alongside acht.                                                                                  |
| [61.3](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/61#discussion_r4297599981) · `content/de-a2/module-03.json:100` | Fixed       | Accept ist alongside liegt.                                                                                         |
| [61.4](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/61#discussion_r4297600277) · `content/de-a2/module-03.json:144` | Fixed       | Accept the standard ins contraction.                                                                                |
| [61.5](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/61#discussion_r4297600650) · `content/de-a2/module-03.json:7`   | Answered    | Retain the owner-selected case-insensitive matching policy and document its spelling limit.                         |
| [61.6](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/61#discussion_r4297600856) · `content/de-a2/module-03.json:6`   | Fixed       | Import tests use the module status by default.                                                                      |
| [61.7](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/61#discussion_r4297601111) · `content/de-a2/module-03.json:52`  | Answered    | Guided practice reuse is permitted; remove the implication that every practice sentence differs from every example. |

### PR #62

| Finding                                                                                                                                          | Disposition   | Response                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [62.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/62#discussion_r4297612041) · `content/de-a2/module-04.json:6`              | Pending owner | Existing content approval metadata is preserved, not independently validated. @1 is a content revision identifier, not the semver curriculum release. No release or import was performed. |
| [62.2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/62#discussion_r4297612261) · `docs/evidence/modules/de-a2-module-04.md:15` | Pending owner | Qualify the unverifiable external waiver; no owner review or specialist approval is fabricated.                                                                                           |
| [62.3](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/62#discussion_r4297612549) · `docs/evidence/modules/de-a2-module-04.md:9`  | Documented    | Carry the LANGLO-125 holdout-separation release blocker forward.                                                                                                                          |
| [62.4](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/62#discussion_r4297612827) · `docs/evidence/modules/de-a2-module-04.md:1`  | Fixed         | Record current observed validation, per-module negative probes and pending acceptance.                                                                                                    |

### PR #63

| Finding                                                                                                                                         | Disposition | Response                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| [63.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/63#discussion_r4297572507) · `content/de-a2/module-05.json:12`            | Fixed       | Replace the exact assessment sentence in the explanation with a different worked example.                                   |
| [63.2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/63#discussion_r4297572777) · `content/de-a2/module-05.json:282`           | Fixed       | Narrow the English cue to at my aunts and name bei explicitly.                                                              |
| [63.3](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/63#discussion_r4297573009) · `content/de-a2/module-05.json:172`           | Fixed       | Accept the cited holdout and practice word-order variants.                                                                  |
| [63.4](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/63#discussion_r4297573227) · `content/de-a2/module-05.json:442`           | Fixed       | Accept darum, daher and deswegen alongside deshalb.                                                                         |
| [63.5](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/63#discussion_r4297573498) · `content/de-a2/module-05.json:517`           | Answered    | Weil was already taught in German A2 module 02. Prerequisites permit cumulative assessment; no need to repeat or remove it. |
| [63.6](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/63#discussion_r4297573750) · `docs/evidence/modules/de-a2-module-05.md:7` | Fixed       | Clarify that authored practice may reuse lesson examples.                                                                   |

### PR #64

| Finding                                                                                                                               | Disposition | Response                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| [64.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/64#discussion_r4297538739) · `content/de-a2/module-06.json:96`  | Fixed       | Accept Es wird morgen regnen.                                                                                           |
| [64.2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/64#discussion_r4297538986) · `content/de-a2/module-06.json:433` | Fixed       | Accept Ich spiele Tennis gern.                                                                                          |
| [64.3](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/64#discussion_r4297539252) · `content/de-a2/module-06.json:7`   | Clarified   | Evidence states that only typographic apostrophe variants are equivalent; inserted and missing apostrophes still count. |

### PR #65

| Finding                                                                                                                                  | Disposition | Response                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------- |
| [65.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/65#discussion_r4297577917) · `tests/curriculum-modules.test.ts:51` | Fixed       | Read only the practised languages field; German-with-French-only corruption is now rejected. |

### PR #66

| Finding                                                                                                                             | Disposition   | Response                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------ |
| [66.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/66#discussion_r4297594224) · `content/en-a1/module-02.json:6` | Pending owner | Preserve the recorded approval status, qualify waiver provenance, and keep release acceptance pending. |

### PR #67

| Finding                                                                                                                                          | Disposition   | Response                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [67.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/67#discussion_r4297606640) · `content/en-a1/module-03.json:278`            | Answered      | The explicit T101 option-reuse exception applies to that.                                                                                              |
| [67.2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/67#discussion_r4297606854) · `content/en-a1/module-03.json:421`            | Answered      | The object form of it is correctly it. Recognition of an unchanged form is valid; a different difficulty choice is optional, not an answer-key defect. |
| [67.3](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/67#discussion_r4297607068) · `docs/evidence/modules/en-a1-module-03.md:3`  | Fixed         | List 009, 010, 013 and 011 explicitly.                                                                                                                 |
| [67.4](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/67#discussion_r4297607368) · `docs/evidence/modules/en-a1-module-03.md:13` | Pending owner | Preserve historical status and identify the waiver as an unverified provenance claim rather than an independently observed review.                     |

### PR #68

| Finding                                                                                                                                         | Disposition | Response                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| [68.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/68#discussion_r4297552641) · `content/en-a1/module-04.json:548`           | Answered    | The explicit T101 option-reuse exception applies to next to and between.                       |
| [68.2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/68#discussion_r4297552845) · `docs/evidence/modules/en-a1-module-04.md:9` | Fixed       | Record current observed validation and negative probes without inventing the original red run. |

### PR #69

| Finding                                                                                                                                         | Disposition | Response                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [69.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/69#discussion_r4297547206) · `docs/evidence/modules/en-a1-module-05.md:1` | Fixed       | Record current observed checks and negative probes.                                                                                                                                              |
| [69.2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/69#discussion_r4297547516) · `content/en-a1/module-05.json:7`             | Fixed       | Exercise real English imperative data with curly apostrophes, case changes, full-form alternatives and a rejected malformed response. Anchor the rule comparison to French module 01 explicitly. |

### PR #70

| Finding                                                                                                                               | Disposition | Response                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------- |
| [70.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/70#discussion_r4297608812) · `content/en-a1/module-06.json:338` | Fixed       | Use a different worked negative sentence in the explanation; the held-out response is no longer printed there. |
| [70.2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/70#discussion_r4297609071) · `content/en-a1/module-06.json:99`  | Answered    | Guided practice may reuse worked examples. Clarify the evidence claim; preserve useful instructional content.  |

### PR #71

| Finding                                                                                                                                         | Disposition | Response                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------ |
| [71.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/71#discussion_r4297645287) · `content/en-a2/module-01.json:404`           | Fixed       | Require ever explicitly so yet and never are not rejected for an unspecified grammatical choice. |
| [71.2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/71#discussion_r4297645565) · `docs/evidence/modules/en-a2-module-01.md:3` | Fixed       | Correct the scope claim and record observed current validation.                                  |

### PR #72

| Finding                                                                                                                               | Disposition | Response                                                |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------- |
| [72.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/72#discussion_r4297540974) · `content/en-a2/module-02.json:436` | Fixed       | Add last night to disambiguate the past inability item. |
| [72.2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/72#discussion_r4297541308) · `content/en-a2/module-02.json:89`  | Fixed       | Explicitly require will in the request blank.           |
| [72.3](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/72#discussion_r4297541550) · `content/en-a2/module-02.json:445` | Fixed       | Explicitly require could in the polite-request blank.   |

### PR #73

| Finding                                                                                                                                         | Disposition | Response                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------- |
| [73.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/73#discussion_r4297562849) · `content/en-a2/module-03.json:120`           | Fixed       | Ask for need to rather than should in the cited item.            |
| [73.2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/73#discussion_r4297563083) · `content/en-a2/module-03.json:374`           | Fixed       | Replace tallest with a genuinely incorrect distractor.           |
| [73.3](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/73#discussion_r4297563326) · `content/en-a2/module-03.json:352`           | Fixed       | Qualify the superlative article rule for possessive determiners. |
| [73.4](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/73#discussion_r4297563558) · `docs/evidence/modules/en-a2-module-03.md:3` | Fixed       | Record current tests and original-evidence limitations.          |

### PR #74

| Finding                                                                                                                                          | Disposition   | Response                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [74.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/74#discussion_r4297578265) · `content/en-a2/module-04.json:239`            | Fixed         | Use Because I was ill, I stayed home as the reason-first key and option.                                                                                                                          |
| [74.2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/74#discussion_r4297578507) · `docs/evidence/modules/en-a2-module-04.md:3`  | Fixed         | Record observed red/green and full validation.                                                                                                                                                    |
| [74.3](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/74#discussion_r4297578723) · `docs/evidence/modules/en-a2-module-04.md:13` | Pending owner | The high-severity acceptance concern remains explicit: no independent owner approval is manufactured and no release is authorized.                                                                |
| [74.4](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/74#discussion_r4297579023) · `content/en-a2/module-04.json:472`            | Answered      | Commas before coordinating so and after an initial if clause are different constructions. Keep the existing punctuation-sensitive policy; accepting an omitted conditional comma is not required. |

### PR #75

| Finding                                                                                                                                         | Disposition | Response                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [75.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/75#discussion_r4297550077) · `docs/evidence/modules/en-a2-module-05.md:3` | Fixed       | Correct the evidence scope and record current validation.                                                                                |
| [75.2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/75#discussion_r4297550279) · `content/en-a2/module-05.json:457`           | Fixed       | Remove the duplicated short-answer label.                                                                                                |
| [75.3](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/75#discussion_r4297550522) · `content/en-a2/module-05.json:12`            | Fixed       | Replace productive passive tasks with passive recognition and active meaning paraphrases; preserve counts, IDs and exercise formats.     |
| [75.4](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/75#discussion_r4297550766) · `content/en-a2/module-05.json:101`           | Answered    | Preserve guided reuse in the remaining practice. Passive tasks changed for catalog scope, not to impose an unapproved no-reuse pedagogy. |

### PR #76

| Finding                                                                                                                               | Disposition | Response                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| [76.1](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/76#discussion_r4297600934) · `content/en-a2/module-06.json:305` | Fixed       | Use the ungrammatical for buy prompt and near miss; limit the rule to for + base verb.                 |
| [76.2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/76#discussion_r4297601175) · `content/en-a2/module-06.json:499` | Fixed       | Accept to get alongside getting after hate.                                                            |
| [76.3](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/76#discussion_r4297601461) · `content/en-a2/module-06.json:350` | Fixed       | Distinguish enjoy/finish from verbs accepting both patterns; no blanket prohibition of to-infinitives. |
| [76.4](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/76#discussion_r4297601742) · `content/en-a2/module-06.json:211` | Fixed       | Ask specifically for the word before a base verb.                                                      |
| [76.5](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/pull/76#discussion_r4297601983) · `content/en-a2/module-06.json:258` | Fixed       | State simple past or present continuous in the affected cues, including the similar holdout.           |

## Disposition counts

24 answered, 2 clarified, 5 documented, 77 fixed, 13 pending owner. Total: 121 threads.
