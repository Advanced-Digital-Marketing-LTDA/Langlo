---
id: langlo-goal
type: goal-and-requirements
status: active
title: Langlo Language Grammar Coach
tags: [product]
---

## Goal

Langlo is a language-learning coach for learners seeking guided grammar practice, progress feedback and spaced-repetition review. This audience and outcome are inferred from the code and existing docs; the owner has not confirmed a narrower primary audience.

## Scope

The repository implements public email/password registration and owner-authenticated learner routes for grammar lessons, practice, assessments and skill-progress reporting. The current catalog includes French A1; German and English A1/A2; and Portuguese B1/B2. It also includes private reading and vocabulary study, grammar-retention and native-card review, learner reports, and versioned curriculum updates. These capabilities are inferred from source and contracts; this document does not claim they have all passed acceptance.

Learner records are owner-scoped. Grammar mastery evidence, grammar-retention scheduling and native flashcard recall are distinct signals. Grammar-evidence status is not CEFR certification or a calibrated prediction of general language proficiency.

Live email delivery, Jev answer evaluation and OpenAI reading assistance have not been end-to-end validated as part of this spec import. The presence of implementation code or configuration is not evidence of live integration acceptance.
