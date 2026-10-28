---
id: langlo-grammar-evidence
type: submodule-design
status: active
title: Grammar Evidence Policy
parent: langlo-server
references: [langlo-assessment-scope-stop, langlo-content-versioning]
tags: [grammar, mastery]
---

# Grammar evidence policy: grammar-2

Version `grammar-2`, 2026-10-22. Local instructional heuristics, not CEFR
certification or a calibrated prediction of language proficiency.

Only the owner's independent grammar responses with a recognized, certain
prepared/fallback evaluation qualify. Practice and mixed review qualify after
submission; assessment responses qualify after the assessment is completed,
by answering every planned question, by the fifth confirmed incorrect answer,
or by the fifth explicit `Not sure` choice. The two five-answer thresholds are
counted separately and need not be consecutive. Only recognized
prepared/fallback verdicts count as confirmed incorrect; evaluator uncertainty
and replayed submissions do not increase either threshold, and fallback
verdicts take precedence. For sessions using grammar retention, completion may
additionally wait for required ratings on qualifying correct answers and for
recent prepared-uncertain evaluations to settle or pass the fallback wait
window. These gates affect completion and evidence-sync timing, not which
submitted responses qualify. On early finalization, only submitted certain
answers are considered; unreached questions are not scored. `Not sure`,
uncertain/unresolved evaluations, assisted responses and quarantined content
cannot add independent evidence. Evaluator uncertainty does not count as an explicit `Not sure` choice or a
confirmed incorrect answer. Prepared evaluator
`prepared-1` must name the attempt's content version as its rubric; current Jev
fallback `jev-2` must name `jev-rubric-1:<contentVersionId>`. Jev asks whether the
answer fulfills the prompt's intended meaning in the target language. Accepted
answers are examples, equivalent grammatically correct forms are allowed,
required grammar/forms and spelling/accents are checked, and capitalization or
punctuation is ignored unless tested by the exercise. Recognized fallback
supersedes the prepared uncertainty, even when fallback remains uncertain.
As of 2026-10-26, written-answer fallback probabilities below `0.60` are
incorrect, from `0.60` inclusive to `0.80` exclusive are unsure (`uncertain`),
and `0.80` or higher are correct. Compare raw probabilities without rounding.
The unchanged rubric remains `jev-rubric-1`; evaluator `jev-2` identifies the
new thresholds. Earlier Jev verdicts remain available in feedback with their
matching rubric, but are not current mastery evidence.
Historical Jev evaluations (`jev-1`), OpenAI Decisions evaluations (`decisions-1`) and prior `grammar-1`
evidence remain stored but do not qualify under `grammar-2`. Unknown evaluator or
rubric versions are excluded until a reviewed policy update.

The first response to a logical item is the only candidate. Item identity is
skill ID plus the question's lineage key. A question's lineage key is stored
with it; for rows imported before lineage keys it is the question ID after
removing its exact `<contentVersionId>:` prefix when present (IDs without that
prefix retain their whole ID). A question that keeps its meaning in a later
version continues the earlier key; a changed or new question has its own. Only
keys present in the skill's current version (its newest version that is not
quarantined) count, so an answer to a changed or removed question stays stored
but stops counting. A resubmission, repeated session, additional evaluation or
republished copy cannot inflate the count. Replacement skill IDs never inherit
evidence from retired skills unless the owner approved carrying a pure rename
over; see [content-update.md](content-update.md).

| Status     | Rule                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------- |
| Unknown    | No qualifying items.                                                                        |
| Weak       | At least one qualifying item, with fewer than 60% correct.                                  |
| Practising | Nonempty evidence that meets neither weak nor secure.                                       |
| Secure     | At least five distinct items across at least two study sessions, with at least 80% correct. |

Uncertain outcomes stay visible in feedback/results and cannot improve the
numerator or denominator. All counts retain their original evaluation and
content version. `skill_evidence` records each qualifying attempt once per policy
version; current totals are recomputed from source history, so late quarantine
can withdraw an item's contribution without deleting history. Evidence is not
transferred to a replacement skill. This version has no time-based decay;
revisit that rule when pilot evidence supports a calibrated retention policy.

Recommendations prioritize weak, practising, unknown and secure, in that order,
with stable skill-ID ties. An available unmet prerequisite can be recommended
first, with its reason. Prerequisites always express suggested teaching order;
they never prevent manual topic access. Missing/quarantined lessons are marked
unavailable. FSRS ratings, due dates, flashcard reviews and session-completion
percentages never enter this policy.
