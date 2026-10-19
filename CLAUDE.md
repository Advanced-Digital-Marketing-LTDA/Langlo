## Global Rules

### Scope discipline

Change only what I explicitly ask you to change. Never remove, restyle, or "clean up" anything else (design, images, animations, layout, code, settings). If I ask for a text rewrite, touch text only. Standard development steps the repo requires (tests, evidence, checks) are expected; this rule means never changing or removing existing work based on assumptions about what I meant.

### Migration immutability

Never modify, rename, renumber, delete, regenerate, or reformat a migration after it has been created. This includes migration SQL and its Drizzle metadata snapshots and journal entries. If a schema change or migration correction is needed, leave existing migration files untouched and add a new forward migration.

### Confirm first

For any task that modifies something (files, sites, code, settings), first list exactly what you will change and what you will leave untouched, then wait for my approval before doing it.
