# Bootstrap status

## Project decisions

- Project: Langlo / Language Grammar Coach; private two-learner pilot, full five language-level curricula and reviewed Windows Anki delivery remain the product goal
- Current slice: T006–T009 neutral scaffold, executable quality harness, safe runtime/error boundaries and isolated durable schema
- Profile: server application; SvelteKit 3.0.1, Svelte 5.57.2, TypeScript 6.0.3, Vite 8.3.3, Node adapter 6.0.0
- Runtime/manager: Node 24.19.0 and npm 11.9.0, one exact lockfile
- Isolation: newly initialized local repository on dev, separate from existing apps; intended origin Bonobo791/Langlo; no remote write
- Selected eventual providers: dedicated Turso/libSQL with Drizzle, bounded OpenAI fallback, Proton SMTP, Coolify hosting and Netlify-managed DNS; none connected or exercised in this slice
- Current storage: actual disposable local file-backed libSQL; only synthetic identities and records
- Current UI: original responsive public foundation shell; private routes deny access before auth is implemented
- Production/external-write limits: no credentials, live calls, spending, real accounts, SSH, DNS, desktop, deployment or production DB access
- Public source: Bonobo791/Langlo and PolyForm Shield 1.0.0 selected; license file implemented (`LICENSE`, `COMMERCIAL.md`); public hygiene and publication remain pending

## Compatibility ruling

The plan requested svelte.config.js and a generated .svelte-kit tsconfig. Current stable Kit 3 requires configuration in vite.config.ts and tsconfig extending $app/tsconfig; hook types come from @sveltejs/kit/hooks. This slice follows the current supported contracts. Private variables use explicit dynamic src/env.ts declarations and $app/env/private. No deprecated config file is supplied. Cost if this ruling is wrong: framework downgrade/migration before later features, with no user data involved.

Official compatibility was checked against package registry metadata and the framework docs on 2026-10-06. Sources: https://svelte.dev/docs/kit/adapter-node, https://svelte.dev/docs/kit/environment-variables, https://svelte.dev/docs/kit/server-only-modules. The setup guidance is pinned at App-Bootstrap-ADM b658231eb20d8920a538ac355a4563c1e4c53096; that repository contains guidance/templates, not the application.

## Requirement status

Exact setup contracts and evidence are expanded in bootstrap-tasks.md. Final local verification: check has zero errors/warnings; lint/format pass; 62 ordinary tests, three default properties and eight built HTTP checks pass; the Node build passes. A fresh local clone with npm ci kept the lockfile unchanged and passed all 62 tests/check/build. See docs/evidence/verification.json. Browser rendering and remote CI remain open.

| IDs                                         | Current status               | Scope/evidence                                                                                   |
| ------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------ |
| C01 inventory/policy                        | Verified locally             | Isolated dev repository, AGENTS and no unrelated edits                                           |
| C02 toolchain                               | Verified locally             | Exact compatible packages, one lockfile; clean-clone install evidence T006                       |
| C03 scripts                                 | Verified locally             | Real check/lint/format/test/property/e2e/build/start scripts; no empty success                   |
| C04 routes/env                              | Verified for this slice      | routes.md/environment.md and config tests; future providers pending                              |
| C05 errors                                  | Verified for this slice      | Safe correlation and allowlisted diagnostics; built invalid-config test evidence T008            |
| C06 tests                                   | Verified for current rules   | Ordinary examples + meaningful config properties; actual DB tests                                |
| C07 CI                                      | Pending remote observation   | Read-only pinned workflow, no secrets; no run or branch protection claim                         |
| C08 public reuse                            | Pending                      | Selected license implemented; complete public hygiene review; no publication                     |
| C09 handoff                                 | In progress                  | README, exact evidence and remaining gates                                                       |
| M01–M03 public marketing                    | Not applicable in this slice | Minimal public shell only; full metadata policy belongs later design/release                     |
| A01 boundaries                              | Verified for this slice      | Server-only config/schema and deny-by-default private routes                                     |
| A02 runtime/errors                          | Verified for this slice      | Dependency-independent liveness, honest 503 readiness, safe failure                              |
| A03 accounts                                | Pending T010                 | No maintained auth chosen or credentials collected                                               |
| A04 ownership                               | Partially verified           | Composite DB relations proven; verified principal and owner-scoped API remain T011               |
| A05 durable data                            | Verified locally             | Actual clean/upgrade migrations, synthetic fixtures and constraints; real Turso recovery pending |
| A06 billing                                 | Not applicable               | No paid plan selected                                                                            |
| A07 integrations                            | Pending                      | OpenAI and SMTP implementation/sandboxes separate; OAuth excluded                                |
| A08 jobs                                    | Not applicable now           | No Redis/worker/scheduler selected; future delivery leases do not imply a scheduled service      |
| A09 uploads                                 | Not applicable               | No learner uploads selected                                                                      |
| A10 lifecycle                               | Pending T026                 | Export/deletion/retention and notices must match future real storage                             |
| A11 shell                                   | Partially verified           | Public UI and server denial; browser launch blocked locally                                      |
| A12 readiness                               | Pending                      | Full real learner journey, providers and release still absent                                    |
| T01–T04 runner/invariants/properties/replay | Current rules verified       | Ordinary discovery, independently stated rules, 100-run default and strict replay controls       |
| T05 layers                                  | Partial                      | Actual DB + built HTTP; browser rendering is blocked by this executor                            |
| T06 fault/mutation                          | In progress                  | Concrete config/DB faults verified in disposable copies; Stryker and domain mutation T025        |
| T07 evidence                                | In progress                  | Exact final command results recorded T006–T009                                                   |
| P01–P05 privacy/analytics                   | Partial / pending            | No analytics integration; safe diagnostics only; real lifecycle/provider operations pending      |
| D01–D08 deployment/release/recovery         | Pending                      | Local Node build/start only; no hosted release, real restore, alert or served-SHA claim          |

## Readiness

Independent next work can build maintained auth/provisioning, owner-scoped operations and the versioned content importer on this foundation. Full curricula still require source audit and checked original content. Provider configuration and paid fallback require separate budget/access choices. Windows loopback feasibility needs an authorized Windows device. Local schema tests do not establish those outcomes.

This executor’s Chromium launch fails on restricted local IPC sockets even with the supported sandbox escalation. The cloud browser also rejects local loopback navigation. Built-server HTTP checks can run here, while rendered desktop/mobile screenshots and full npm run test:e2e must be verified in a suitable authorized environment before T007/browser acceptance is complete.
