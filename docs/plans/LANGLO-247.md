# Extend native FSRS scheduling to grammar practice and retention

**Tracker:** [LANGLO-247](https://plan.advanceddigitalmarketingltda.com/LANGLO-247), initiative 82. This local plan records the agreed contract; it does not update tracker status or authorize release.

## Local implementation status

The policy, feasibility check, persistence, rating flows, bounded due queue, separate status display, and local browser/non-regression checks are implemented in this worktree. Delayed-recall calibration and the broader pilot readiness decision remain pending; this status does not indicate tracker completion, learner exposure, or release readiness. Evidence: [LANGLO-247](../evidence/LANGLO-247.md).

## Goal and boundary

Use the existing `ts-fsrs` scheduler and account study settings to schedule retrieval practice for grammar skills. Keep grammar-1 mastery evidence and native flashcard schedules independent. A grammar FSRS prediction is an experimental recall signal, not CEFR evidence or a reason to rewrite a historical mastery status.

The initial scheduling unit is one learner, language and existing skill. Every qualifying review uses varied published questions where available. A question seen in an earlier session may be reused for retention if answered without assistance before feedback; it still does not become new independent mastery evidence under the current mastery policy.

## Accepted pilot contract

### Rating and eligibility

The policy version is `grammar-fsrs-1`. Answer first, reveal the correct answer and feedback, then rate, in the order learners know from Anki. A certain, independently evaluated incorrect answer receives Again. After a correct answer, the learner chooses Hard, Good or Easy. Practice presents the answer and rating step as each question is answered.

Assessments keep their current delayed-results behavior: learners answer the complete assessment first, then see answers and feedback at the end and choose Hard, Good or Easy for each correct response. An assessment remains incomplete until required correct responses are rated. An incorrect response is rated Again automatically. An unrated answer is treated as never given: it cannot be committed as an answer/evaluation, contribute mastery evidence or affect FSRS. Assessment provisional responses may only become durable evaluated answers after the rating stage accepts them; discard paths must remove provisional learner data. The implementation must preserve the existing rule that assessment results remain hidden before completion.

Only certain, independently answered responses against current approved content qualify. Assisted responses, “not sure”, incomplete assessments, uncertain evaluation, quarantined or unavailable content, abandoned sessions, and correct answers with no difficulty rating produce no saved answer/evaluation or scheduling signal. This does not erase earlier qualifying evidence.

At most one event updates a skill in a completed session. If multiple qualifying responses cover that skill, use the lowest rating in the order Again, Hard, Good, Easy. Persist its source attempt, evaluation version and content lineage. Idempotent retries or a repeated evaluation cannot create another event for the same logical skill review.

| Scenario                                                                                                             | Saved answer/mastery evidence                                    | Grammar FSRS                                                                    |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Certain independent incorrect answer in a qualifying completed session                                               | Existing mastery rules apply                                     | One Again contribution for that skill/session                                   |
| Certain independent correct answer rated Hard, Good or Easy                                                          | Existing mastery rules apply                                     | Selected rating contributes; if several qualify, the skill's lowest rating wins |
| Previously seen question, answered without assistance and rated                                                      | Existing mastery rules still count the repeat as non-independent | Eligible for the retention review                                               |
| Assisted, “not sure”, uncertain, quarantined/unavailable content, incomplete assessment, or unrated correct response | No answer/evaluation or new mastery evidence from that response  | No update                                                                       |
| Duplicate submission or reevaluation of the same response                                                            | Preserve the first accepted result                               | No duplicate event                                                              |

### Settings, time and content

Use the learner's saved Settings tab study schedule: desired retention, new-card steps and relearning steps. Store the actual scheduler version and parameters with the review. A settings edit applies to a skill on its next review; it does not move an existing due date.

Use existing account-timezone and study-day conventions: store UTC event times, apply the learner's configured IANA timezone and the established 04:00 study-day boundary for day intervals, and retain exact times for learning steps. Until a timezone is saved, existing behavior uses UTC.

Every published content-version change for a skill resets that skill's current retention state and makes it due for a new rated review. Preserve all old review events and grammar mastery history; do not infer historical ratings or migrate events to another skill. Exclude retired, quarantined and unavailable skills from new reviews and the due queue.

### Queue and learner display

Provide a manual due-review path of at most five skills per session and one question per skill. Prefer a different eligible question from the most recent review when available; permit previously seen questions under the eligibility rule above. Apply learning steps when a skill becomes due again, including short steps in a later session. Prerequisites guide ranking and do not block manual choice. A missing schedule or content variant falls back to existing manual grammar practice.

Show historical mastery/status and its evidence separately from retention status. Retention starts as **Not assessed**; do not backfill FSRS from past attempts. Show whether a schedule is due or overdue and give an accessible reason for a suggestion. A qualitative **Estimated recall below your target** warning is permitted when FSRS retrievability falls below the saved desired-retention target. Do not show a percentage, relabel mastery as Weak, or imply a calibrated probability.

## Feasibility result and limitation

The bounded synthetic comparison in `tests/grammar-retention-feasibility.test.ts` uses `ts-fsrs@5.4.2`, fixed dates, fuzz disabled, six varied ratings, and new prompts. One skill schedule reached six repetitions and stability about 116.46; six separate prompt schedules each had one repetition, with maximum stability about 8.30. This confirms that skill and prompt granularity produce very different scheduler states. It does not show which state predicts delayed grammar recall. Keep skill scope as the least new taxonomy for this pilot and treat its estimates as experimental until unseen equivalent-item and delayed-recall evidence is reviewed.

## Implementation sequence and review gates

1. **Policy and feasibility (LANGLO-248):** this contract, decision record, synthetic behavior matrix, and a bounded test of skill versus prompt schedules. Review the written contract before feature implementation.
2. **Persistence (LANGLO-249):** add only forward Drizzle migration(s) for owner-scoped, language/skill-keyed FSRS state and immutable review events. Include revision, due state, scheduler version/parameters, event UTC time, rating, and original attempt/evaluation/content references. Add composite ownership and idempotency constraints; preserve deletion and export behavior.
3. **Validated ratings (LANGLO-250):** integrate the server-owned scheduler with practice and assessment result flows. Keep assessment correctness hidden until all answers are submitted; collect correct-answer ratings at the assessment end stage; discard unrated responses. Commit a single aggregated skill event only when the session qualifies and completes. Reuse existing evaluation, retries and owner-bound transactions.
4. **Due queue (LANGLO-251):** use the FSRS state and current content to rank due grammar reviews, respect account timezone and settings, bound the review session, and preserve manual selection and prerequisite guidance.
5. **Separate displays (LANGLO-252):** show historical mastery and estimated retention, due state, last qualifying mastery evidence and accessible reasons without changing the grammar-1 score.
6. **Calibration (LANGLO-253):** evaluate delayed recall on unseen equivalent questions across skills, tracks and prior experience. Report uncertainty, leakage controls, metric definitions and sparse-data limitations. No claim based only on immediate accuracy or two learners. Keep thresholds and mapping unchanged absent evidence and owner review.
7. **Non-regression (LANGLO-254):** test ratings, ownership, repeat items, content resets, settings changes, idempotency/concurrency, rollback, time boundaries/DST, incomplete assessment discard, queue bounds, accessibility, second learner, and unchanged grammar-1 and native-card behavior.
8. **Pilot decision (LANGLO-255):** record an evidence-based readiness decision, privacy/deletion behavior, source versions, limitations and rollback/exposure controls. Feature implementation does not itself authorize learner exposure, production deployment, automatic tuning, or proficiency claims.

## Files expected in the implementation phase

This list is a planning guide and will be rechecked against the approved contract before code changes:

- `src/lib/server/db/schema.ts` and a new forward migration plus its generated Drizzle snapshot and journal entry; never change existing migration artifacts.
- Existing scheduler/settings code in `src/lib/server/flashcards.ts`, study and assessment evaluation paths in `src/lib/server/study.ts`, `src/lib/server/assessment.ts`, and `src/lib/server/assessment-answer.ts`; add one focused server-only grammar-retention module under `src/lib/server/` if existing modules cannot keep the boundary clear.
- Practice and assessment routes/components, the skill map and recommendations for queue and separate status display; preserve current navigation and feedback/accessibility.
- Focused server, route, property and browser tests in `tests/`, with synthetic fixture databases only; `docs/evidence/LANGLO-247.md` for red/green outputs and pending acceptance.

## Acceptance gates

- Preserve grammar-1 mastery history and native flashcard state; grammar recall is separate.
- Owner-scoped state and events; append-only review events, idempotent submission, revision conflict protection and transaction rollback.
- Only qualifying completed sessions change schedule. Replays, ineligible answers, unrated correct answers and incomplete sessions never strengthen retention.
- Settings changes take effect at next review; current due dates remain stable until then. Verify UTC storage, timezone changes and DST behavior against existing contracts.
- A content-version change resets only the affected live schedule, keeps past events and makes the skill due.
- Validate due ordering, five-skill queue cap, one question per skill, question variation, manual choice, prerequisites-as-guidance and unavailable-content fallback.
- Test accessible practice and assessment answer/reveal/rating flows, including assessment results hidden until end and discard of unrated answers.
- Local checks are evidence only for this worktree. CI, live-provider behavior, calibrated retention, production state and release remain separate acceptance gates.
