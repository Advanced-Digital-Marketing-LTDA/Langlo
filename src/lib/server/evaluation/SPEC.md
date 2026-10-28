---
id: langlo-evaluation
type: submodule-design
status: draft
title: Server Evaluation Services
parent: langlo-server
tags: [evaluation, server-only]
---

## Responsibility

Produce versioned outcomes for learner exercise attempts. Prepared evaluation compares against the checked rubric; an optional TypeSafe fallback evaluates unmatched typed answers.

## Boundary

- Prepared typed matching normalizes case, whitespace, apostrophe style and final punctuation while preserving accents; a non-match stays uncertain rather than becoming incorrect. Multiple-choice answers are matched exactly.
- The fallback receives exercise content as untrusted grading input. Provider errors, timeouts, low confidence and exhausted usage limits do not create a guessed verdict; usage is capped and versioned.
- This module supplies evaluation outcomes, not current mastery or grammar-retention policy. Those decisions remain in the owning server study services and their adopted contracts. Local tests do not establish live TypeSafe acceptance.
