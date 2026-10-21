# Interactive skill map

Implemented locally on 2026-10-20. Behavior and required local validation are
recorded in [the evidence log](../evidence/interactive-skill-map-20261020.md).

## Scope

Provide an interactive grammar skill map and overall/per-language progress bars
for Secure, Practising, Weak, and Unknown skills. Domain terms are recorded in
CONTEXT.md. Mastery calculations, learner data, migrations, settings, and remote
services remain unchanged.

## Agreed decisions

- Use a branching prerequisite map. Topics are selectable nodes; connections
  show recommended foundations. Learners may open any available topic regardless
  of prerequisite status.
- Show an overall segmented bar across all enrolled languages, plus a bar for
  each language. Segments show state counts and percentages. Each available skill
  counts equally; unavailable lessons are excluded. For example, 12 Secure skills
  out of 40 available skills means 30% Secure. Do not assign partial mastery
  weights to the other states.
- Selecting a topic opens a details panel beside the map, or a bottom sheet on
  mobile. Preserve the learner's map position while exploring topics.
- Topic details show the mastery state and its reason, recommended foundations
  with controls to highlight them, practice counts, qualifying evidence, and
  Open lesson and Practise this topic actions.
- Practise this topic starts a practice session and opens the selected topic's
  exercises directly, without a confirmation screen or another topic chooser.
  Open lesson opens the explanation without starting practice. Returning to the
  map restores the selected topic, filters, and position, then refreshes progress.
- Display one language map at a time, selected through language tabs. Keep the
  overall progress bar visible. Within each language, arrange branches from
  foundations toward more advanced topics, grouped into A1 and A2 sections.
  Initially select the learner's current language and focus its recommended
  topic. If no current language is selected, use the first enrollment in the
  existing order. If there is no recommendation, fit the full language map
  without selecting a topic. If there are no enrollments, offer the action to
  choose a language. Restored map context takes precedence on return from a
  lesson or practice.
- Provide topic-title search with matching nodes highlighted, and mastery-state
  and A1/A2 filters. Keep connected foundations visible but dimmed for context.
- Provide pan, zoom, Fit map, and Go to recommended topic controls usable with
  touch and keyboard. Include an equivalent list view with the same details and
  actions. Search and filters do not alter progress-bar totals.
- Keep topics whose lessons cannot currently be opened visible in the map,
  including their foundation connections. Do not add an Unavailable label.
  These topics remain excluded from progress-bar totals. Keep them selectable
  for mastery evidence and foundations; omit Open lesson and Practise this topic
  when those actions cannot work.
- Each language's map and bar become usable when that language's progress has
  loaded. The overall bar waits for all enrolled languages. If any language
  fails, show a retry message instead of a partial overall percentage, while
  leaving successfully loaded maps usable.
- Loading nodes show Checking progress rather than Unknown. With no available
  skills, show No skills available to measure yet instead of a percentage.
  Show exact state counts alongside rounded percentages, with displayed
  segments totaling 100% when the denominator is nonzero.

## Initial source facts

- The map route currently renders GrammarProgress as topic cards grouped by
  language and A1/A2, with prerequisite links and practice counts.
- Grammar statuses already exist. Practice counts are separate from qualifying
  independent grammar evidence. This design does not change scoring policy.
- The existing dashboard summary excludes unavailable skills, while the map
  currently also displays unavailable topics.
- Map catalogs and progress load progressively per language. Loading or failed
  progress must not be presented as Unknown evidence.
- Existing practice creates a language-wide session, then lets the learner
  choose a topic. The lesson route accepts that session ID to serve exercises.
  Opening a lesson without a session is distinct from starting practice.

## Acceptance criteria

- Topic nodes and foundation connections are interactive, with the same topic
  information and actions accessible in the list view.
- Language switching, search, filters, pan, zoom, fit, recommendation focus, and
  foundation highlighting work with keyboard and touch. Status is communicated
  through text and symbols as well as color. Details have appropriate focus
  handling on desktop and mobile.
- Overall and per-language bars use available-skill counts, remain independent
  of filters, and handle zero totals, rounding, loading, and failures honestly.
- Topics without available lessons remain visible and selectable without an
  Unavailable label or lesson/practice actions.
- Topic practice starts through an owner-scoped, validated, idempotent action
  and opens that topic directly. Merely selecting a node or opening its lesson
  must not start a session.
- Returning from lessons and practice restores map context and refreshes
  progress. Existing mastery policy, session behavior, and learner ownership
  rules remain intact.
- Behavior tests demonstrate observed red and green runs, and required local
  checks are recorded with pending acceptance in docs/evidence. Local validation
  does not establish provider, CI, deployment, or release success.

## Delivered scope

- `src/routes/app/map/+page.svelte`: map page, language selection, overall bar,
  loading, error, and empty states.
- `src/routes/app/map/+page.server.ts`: retain all enrolled tracks for overall
  totals and add a validated action for direct topic practice.
- `src/lib/components/SkillMap.svelte` (new): branching map, topic panel, mobile
  sheet, controls, filters, and equivalent list view.
- `src/lib/components/SkillProgressBar.svelte` (new): shared segmented bar.
- `src/lib/skill-map.ts` (new): deterministic graph layout and progress display
  calculations, reusing existing mastery labels, symbols, and summary logic.
- `src/routes/app/learn/[language]/lesson/[skill]/+page.server.ts` and
  `+page.svelte`: sanitize the map return path and provide return navigation.
- `tests/map-render.test.ts` and `tests/progress-routes.test.ts`: update existing
  map expectations and verify the new server action's validation and ownership.
- `tests/learner-routes.test.ts`: verify the return path boundary.
- `tests/skill-map-render.test.ts` (new): verify accessible progress-bar output
  and loading states.
- `tests/skill-map.test.ts` and `tests/skill-map.pbt.test.ts` (new): layout,
  filtering, and progress calculation behaviors and invariants.
- `tests/e2e/map-errors.spec.ts` and `tests/e2e/exercises.spec.ts`: adjust affected
  map journeys and cover map interaction, language switching, lesson return,
  unavailable topics, and loading failures on desktop and mobile.
- `tests/helpers/render-svelte.ts` and
  `tests/helpers/app-navigation-stub.ts` (new): render the Svelte components in
  unit tests with the app navigation dependency stubbed.
- `docs/evidence/interactive-skill-map-20261020.md` (new): observed red/green,
  required checks, and acceptance limitations.
- `docs/plans/interactive-skill-map.md`: this implementation record.

Leave the shared GrammarProgress component and its separate progress page,
dashboard, prototype routes, mastery calculations, recommendation policy,
database schema and migrations, curriculum, authentication, provider settings,
dependencies, and CI configuration unchanged. If inspection during implementation
reveals that another application file is necessary, explain that scope change
before editing it. No push, PR, deployment, or real provider access is included.

No ADR is needed for the decisions agreed so far.
