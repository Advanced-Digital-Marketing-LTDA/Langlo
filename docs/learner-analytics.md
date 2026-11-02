---
id: langlo-learner-analytics
type: submodule-design
status: draft
title: Learner Analytics Services
parent: langlo-server
tags: [learner-analytics, ownership, privacy]
---

## Responsibility

Provide private, owner-scoped summaries of study activity in `/app/analytics`: completed and scheduled flashcard and grammar reviews, plus recorded active study time.

## Boundary

- Review totals and due schedules are derived from that learner’s persisted review events, cards and grammar-retention state. Historical counts extend up to 365 study days; scheduled counts extend forward from the current day through the last day with scheduled work.
- Study-time segments record category and start/end instants, not answers or document content. The server bounds segment length, age and clock skew, merges overlapping intervals of one category, and groups totals by the learner’s saved IANA timezone (UTC when unset).
- The page reports application state; it is not an audit of attention or proof of time spent. Inputs are client-reported, and the feature is local learner analytics rather than an external product-analytics integration.
