# Grammar evidence policy: grammar-1

Version `grammar-1`, 2026-10-17. Local instructional heuristics, not CEFR
certification or a calibrated prediction of language proficiency.

Only the owner's independent grammar responses with a recognized, certain
prepared/fallback evaluation qualify. Practice and mixed review qualify after
submission; assessment responses qualify only after the whole session is
completed. `Not sure`, uncertain/unresolved evaluations, assisted responses and
quarantined content cannot add independent evidence. Prepared evaluator
`prepared-1` must name the attempt's content version as its rubric; fallback
`decisions-1` must name `fallback-rubric-1:<contentVersionId>`. Recognized fallback
supersedes the prepared uncertainty, even when fallback remains uncertain.
Unknown evaluator/rubric versions are excluded until a reviewed policy update.

The first response to a logical item is the only candidate. Item identity is
skill ID plus question ID after removing its exact `<contentVersionId>:` prefix
when present. This preserves local item identity across content versions. IDs
without that prefix retain their whole question ID. A resubmission, repeated
session, additional evaluation or republished copy cannot inflate the count.
Changing an item's identity or meaning requires content maintenance review;
replacement skill IDs never inherit evidence from retired skills.

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
