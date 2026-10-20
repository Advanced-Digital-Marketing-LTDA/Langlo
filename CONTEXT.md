# Langlo domain terms

- **Study schedule**: account-wide desired retention plus the fixed learning and relearning presets used when a card is first approved or next rated.
- **Desired retention**: the learner-selected FSRS target, stored as a percentage from 70% through 97%. A higher target produces shorter intervals and more frequent reviews.
- **New-card steps**: one of `10m`, `1m + 10m`, or `30m`; **relearning steps** after forgetting are `10m`, `30m`, or `1h`. Steps remain within the same day.
- **Study day**: the account-local day boundary at 04:00. Until the learner saves a timezone, scheduling and previews use UTC. Day intervals become due at the start of the local due study day; learning steps use exact times.
- **Note and card**: a note owns one stable card identity. Moving the note between the learner's decks or changing its tags does not change card state or review history.
- **Illustrative workload preview**: a seven-study-day comparison of saved and selected settings that assumes a Good rating at each simulated review. It is a scenario, not a forecast.
- **Suspended card**: an approved card excluded from due counts and scheduling queues until resumed. Its state and review history remain stored.
