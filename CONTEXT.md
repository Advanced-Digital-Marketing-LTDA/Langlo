---
id: langlo-domain-context
type: module-design
status: active
title: Langlo Domain Concepts
parent: langlo-goal
tags: [domain-language]
---

# Langlo domain terms

- **Study schedule**: account-wide desired retention plus the fixed learning and relearning presets used when a card is first approved or next rated.
- **Desired retention**: the learner-selected FSRS target, stored as a percentage from 70% through 97%. A higher target produces shorter intervals and more frequent reviews.
- **New-card steps**: one of `10m`, `1m + 10m`, or `30m`; **relearning steps** after forgetting are `10m`, `30m`, or `1h`. Steps remain within the same day.
- **Study day**: the account-local day boundary at 04:00. Until the learner saves a timezone, scheduling and previews use UTC. Day intervals become due at the start of the local due study day; learning steps use exact times.
- **Note and card**: a note owns one stable card identity. Moving the note between the learner's decks or changing its tags does not change card state or review history.
- **Illustrative workload preview**: a seven-study-day comparison of saved and selected settings that assumes a Good rating at each simulated review. It is a scenario, not a forecast.
- **Suspended card**: an approved card excluded from due counts and scheduling queues until resumed. Its state and review history remain stored.
- **Active assessment skill**: a non-retired skill in the selected language. A new assessment needs one current, unseen holdout question for every active skill.
- **Explicit Not sure**: the learner's submitted choice that they do not know an answer. It is separate from an evaluator's uncertain verdict; five explicit choices finalize the assessment.
- **Unreached assessment question**: a planned question with no submitted response. Partial results report its count without scoring or revealing its answer.

## Grammar retention

- **Grammar retention schedule**: the FSRS recall state for one learner, language and grammar skill. It is separate from grammar mastery evidence and native flashcard recall.
- **Grammar recall review**: a completed practice session or assessment that qualifies to update one or more grammar retention schedules.
- **Grammar retention rating**: Again, Hard, Good or Easy applied after answering and revealing feedback. Incorrect answers receive Again; a correct answer needs the learner's Hard, Good or Easy choice.
- **Unassessed retention**: a skill with no grammar retention schedule yet. Existing grammar history does not create one.
- **Grammar retention warning**: a qualitative signal that estimated recall is below the learner's desired retention setting. It is not a grammar mastery status or a calibrated probability.
- **Skill map**: a branching view of grammar topics and their recommended foundations. A foundation suggests a learning order; it does not prevent access to an available topic.
- **Skill-state distribution**: the counts and proportions of available skills that are Secure, Practising, Weak, or Unknown. Each available skill counts equally; unavailable lessons are excluded.
- **Overall skill progress**: the skill-state distribution across all enrolled languages. Per-language progress uses the same measure within one enrolled language; neither measure certifies a CEFR level.
