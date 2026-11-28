# Cognix Build Performance Roadmap

**Status:** In progress — Core implementation slices for Phases 0–6 landed behind server-side feature flags on 2026-11-28  
**Primary objective:** Reduce normal prompt-to-working-preview time from 15–20 minutes to 2–5 minutes without weakening build correctness, runtime verification, security boundaries, existing-project support, or frontend quality.

## Implementation progress

### Delivered so far (code + unit tests, gated behind feature flags)

- **Phase 0 — Telemetry, stage attribution & benchmark harness**:
  - Privacy-safe per-run telemetry (`src/lib/ai/run-performance.ts`), `agent_run_metrics` table + migration (`drizzle/0012_agent_run_performance.sql`), and admin export (`/api/admin/performance`).
  - Mutually exclusive fine-grained stage attribution (`sandbox`, `setup`, `scaffold`, `cloud`, `agent`, `model`, `tool`, `install`, `build`, `preview`, `probe`, `approval`, `verification`, `github`, `persistence`) via `withStage`, plus exact `previewRestarts`, `unchangedFileRereads`, and architecture flag metadata.
  - Fixed 7-task benchmark catalog, deterministic correctness judges, p50/p95 aggregator, baseline regression comparator, and pure-Node CLI (`src/lib/benchmarks/suite.ts`, `src/lib/benchmarks/judges.ts`, `src/lib/benchmarks/suite.test.ts`, `scripts/run-benchmarks.mjs`).
- **Phase 1 & Phase 2 — Versioned golden scaffold composer & early preview bootstrap (`COGNIX_PERF_SCAFFOLD_BOOTSTRAP`)**:
  - Server-side rollout feature flags (`src/lib/feature-flags.ts`, `.env.example`) defaulting to `false`.
  - Canonical repository-stored Web base + composable `database`, `auth`, `storage`, and `email` overlays (`src/lib/scaffold/types.ts`, `src/lib/scaffold/profiles.ts`, `src/lib/scaffold/composer.ts`, `src/lib/scaffold/composer.test.ts`) with deterministic SHA-256 manifests, pure `schema.ts` composition, secret scanning, and strict preservation of existing/imported projects (`isEligibleForNewProjectScaffold`).
  - Deterministic pre-Turn-0 scaffold materializer & early persistent preview startup (`src/lib/scaffold/bootstrap.ts`) wired into `src/lib/ai/runner.ts`.
- **Phase 3 — Bulk tools, adaptive turn budgets & loop guard (`COGNIX_PERF_BOUNDED_AGENT`)**:
  - Added bulk `read_files` (12-file / 180 KB / binary & `.env*`-safe) and transactional `batch_edit_files` (atomic pre-write validation + approval gating in Security review mode) in `src/lib/ai/tools.ts` and `src/lib/ai/security-tools.ts`.
  - Added task-complexity adaptive turn budgets (`resolveAdaptiveTurnBudget`) and SHA-256 read-deduplication / command-streak / preview-check loop guard (`src/lib/ai/loop-guard.ts`) wired into `src/lib/ai/runner.ts`.
- **Phase 4 & Phase 5 — Context compaction, diagnostic parser & one-build guards (`COGNIX_PERF_CONTEXT_COMPACTION`, `COGNIX_PERF_ONE_BUILD`)**:
  - Added 6-turn / bulk-read / 90 KB context compaction (`shouldCompactContext`, `compactAgentMessages` with orphaned tool-call trimming and non-fabricated verified-check reporting) plus deterministic command output truncation (`src/lib/ai/context-compaction.ts`).
  - Added deterministic TypeScript / Next.js / package-manager / Drizzle / runtime diagnostic parser (`src/lib/ai/diagnostic-parser.ts`) and guarded finalization against redundant `npm install` when `node_modules` is present and manifests did not change.
- **Phase 6 — Deterministic safe autofixers & fast commit messages**:
  - Added narrowly scoped deterministic autofixers (`drizzle-config-env-load`, `schema-server-only-import`, `s3-client-checksums`, `missing-use-client-directive`) and zero-LLM conventional commit builder (`src/lib/ai/autofix.ts`, `src/lib/ai/autofix.test.ts`), wired into GitHub finalization when `COGNIX_PERF_BOUNDED_AGENT` is enabled.

### Still open (operational execution, browser E2E judges & canary soak)

- Add headless browser-based responsive/accessibility/interaction E2E runner feeding `judgeResponsiveAndAccessibility`.
- Execute at least five live baseline runs per benchmark against the current architecture and save comparable p50/p95 results before enabling canary flags.
- Evaluate optional Daytona snapshot / warm-sandbox pool acceleration for package cache startup.
- Wire safe autofixer invocation into the automated repair path behind a dedicated opt-in check after shadow testing.
- Complete Phase 7 staged canary rollout (internal → 5% → 25% → 50% → 100%) and two-week stability soak before removing legacy fallback paths.

## 1. Baseline and diagnosis

The two most recent recorded Quill Sync build runs establish the current failure mode:

| Run | Duration | Model turns | Tool calls | Commands | Production builds | Input tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Initial full-stack build | 20.47 min | 100 | 226 | 40 | 9 | 6.96M |
| Follow-up repair | 21.85 min | 100 | 216 | 28 | 3 | 5.64M |

Both runs exhausted the 100-turn agent budget. The dominant cost is repeated model/tool cycles and repeated context ingestion, not dependency installation alone. The initial run spent about five minutes in terminal commands; its two recorded install commands consumed only about 6.5 seconds because the package cache was warm. A prebuilt scaffold remains important because it removes setup decisions, compatibility failures, file generation, and repair turns—not merely `npm install` wall time.

Current architectural contributors:

- New Daytona sandboxes start from plain `node:22-bookworm`, not a Cognix application image or snapshot.
- The model creates framework configuration, package manifests, integrations, and application code itself.
- The agent may execute up to 100 sequential model turns.
- Independent tool calls are awaited sequentially.
- Full tool outputs and file contents accumulate in the model context; focused context refresh occurs only every 28 turns.
- The base Build-mode prompt and tool definitions are substantial before project history and tool results are added.
- Production builds are cold and may be repeated several times.
- Preview, migration, runtime, finalization, and GitHub work can duplicate checks already performed by the agent.

## 2. Target service levels

Targets must be evaluated on equivalent features and verification—not by showing an incomplete preview early and calling the task finished.

| Metric | Frontend-only target | Full-stack target |
| --- | ---: | ---: |
| First interactive preview, p50 | ≤ 90 sec | ≤ 120 sec |
| First interactive preview, p95 | ≤ 180 sec | ≤ 240 sec |
| Verified completion, p50 | ≤ 4 min | ≤ 6 min |
| Verified completion, p95 | ≤ 7 min | ≤ 10 min |
| Model turns, p50 | ≤ 12 | ≤ 18 |
| Model turns, p95 | ≤ 20 | ≤ 30 |
| Input tokens per run, p50 | ≤ 500K | ≤ 900K |
| Production builds per successful run | 1 normally | 1 normally |
| Extra production-build repair attempts | ≤ 1 | ≤ 2 |

Quality guardrails:

- No reduction in production-build pass rate.
- No increase in preview HTTP 5xx, uncaught runtime errors, or broken primary flows.
- No regression in responsive, accessibility, design-consistency, database, authentication, or storage checks.
- No secrets embedded in templates, images, logs, browser bundles, or generated source.
- Existing projects retain their current framework and dependencies; the scaffold applies only to genuinely new projects.

## 3. Proposed target architecture

The optimized flow is:

> Classify request → provision versioned scaffold → start immediate preview → gather context once → make batched edits → run incremental checks → perform one clean production build → smoke-test runtime → return result

The model should implement product-specific UI, schema, business logic, and integrations. Deterministic platform code should own repeatable setup, dependency compatibility, environment injection, preview startup, common validation, and finalization.

### Scaffold profiles

Use one stable base plus composable, versioned feature overlays rather than one oversized template containing every dependency:

1. **Web base:** Next.js App Router, React, TypeScript, Tailwind, Geist, Lucide, Zod, design tokens, accessible primitives, loading/error/not-found foundations, visual-edit bridge, and preview telemetry.
2. **Database overlay:** Drizzle configuration, PostgreSQL client, migration scripts, connection helpers, validation patterns, and health checks.
3. **Authentication overlay:** Better Auth server/client setup, middleware, protected-route helpers, and accessible sign-in/sign-up foundations.
4. **Storage overlay:** Cognix Cloud Storage server adapter, validation, same-origin file route, upload/download helpers, and states.
5. **Email overlay:** Server-only email adapter and safe templates, included only when requested.

The generated project remains standard, exportable source code. Per-project schema and product logic remain model-generated. Project credentials continue to be injected through the existing server-side environment synchronization.

## 4. Roadmap overview

| Phase | Outcome | Indicative duration | Depends on |
| --- | --- | ---: | --- |
| 0 | Reliable performance telemetry and benchmark suite | 2–3 days | None |
| 1 | Versioned golden scaffold and dependency profiles | 4–6 days | Phase 0 |
| 2 | Deterministic bootstrap and early preview | 3–5 days | Phase 1 |
| 3 | Bounded, batched agent execution | 5–8 days | Phase 0 |
| 4 | Context and token reduction | 4–6 days | Phase 3 |
| 5 | Incremental verification and one-build policy | 4–6 days | Phases 2–4 |
| 6 | Model routing, deterministic autofix, and critical-path cleanup | 3–5 days | Phases 3–5 |
| 7 | Canary rollout, measurement, and legacy fallback removal | 5–7 days | Phases 0–6 |

Phases 1–2 and 3–4 may be developed in parallel after Phase 0. For one engineer, expect roughly 5–7 weeks including soak time. Do not compress rollout gates merely to hit the calendar estimate.

## 5. Phase-by-phase implementation plan

### Phase 0 — Instrumentation and reproducible benchmarks

**Goal:** Establish trustworthy stage-level evidence before optimizing.

#### TODO

- [ ] Define run stages: sandbox acquisition, scaffold/bootstrap, cloud provisioning, model wait, tool execution, dependency install, incremental checks, production build, preview startup, runtime probes, GitHub finalization, and persistence.
- [ ] Record stage start/end timestamps, success state, retry count, and non-sensitive error category.
- [ ] Record per-turn prompt/completion/cached-token usage, tool count, context size, and model latency.
- [ ] Record time to first preview separately from time to verified completion.
- [ ] Record install count, build count, preview restarts, context refreshes, and repeated reads of the same unchanged file.
- [ ] Add an admin performance view or structured export for percentile analysis; never expose prompts, source, or secrets in metrics.
- [ ] Create a fixed benchmark suite:
  - [ ] Responsive marketing site.
  - [ ] CRUD notes application.
  - [ ] Authenticated dashboard with database persistence.
  - [ ] Realtime/chat-style application with database and storage.
  - [ ] Existing-project one-component edit.
  - [ ] Screenshot/reference-based responsive reconstruction.
  - [ ] Runtime-error repair task.
- [ ] Run each benchmark at least five times on the current architecture and save p50/p95 results.
- [ ] Add correctness judges: build, route probes, runtime console, primary interaction, responsive overflow, accessibility smoke checks, and expected cloud resources.

#### Exit gate

- Stage timings account for at least 95% of total run duration.
- Benchmarks are repeatable and distinguish first preview from verified completion.
- Baseline results can be compared without inspecting user data.

### Phase 1 — Golden scaffold and dependency profiles

**Goal:** Remove framework setup and integration boilerplate from the model’s responsibilities.

#### TODO

- [ ] Decide through a short spike whether Daytona custom images, snapshots, or a versioned template copied into the project offer the best startup, portability, and rollback behavior.
- [ ] Create the Web base scaffold with tested configuration and a locked dependency graph.
- [ ] Create composable Database, Authentication, Storage, and Email overlays.
- [ ] Add a `templateVersion`/manifest containing framework versions, profile capabilities, file hashes, and migration compatibility.
- [ ] Add deterministic overlay composition with conflict tests.
- [ ] Prewarm the package-manager cache or snapshot `node_modules` outside Git; verify Linux architecture and native-package compatibility.
- [ ] Keep all credentials and tenant identifiers out of images, snapshots, templates, lockfiles, and fixtures.
- [ ] Preserve `.env.local` generation through the existing server-only environment path.
- [ ] Include the visual-edit bridge and preview telemetry in the base scaffold.
- [ ] Add automated scaffold tests for install integrity, production build, dev startup, route probes, and secret scanning.
- [ ] Add a dependency-update workflow and scheduled security audit for scaffold versions.
- [ ] Define template support and rollback policy: retain at least the current and previous known-good versions.

#### Exit gate

- A new base project reaches a healthy preview without a model call.
- Each profile combination builds and starts successfully from a clean sandbox.
- No secret value or environment-specific endpoint is present in the scaffold artifact.

### Phase 2 — Deterministic bootstrap and early preview

**Goal:** Put a working application on screen quickly while deeper implementation continues.

#### TODO

- [ ] Reuse the existing cloud-intent classifier to select the smallest sufficient scaffold profile.
- [ ] Apply scaffolding only when the project is truly new and has no user-owned `package.json`; never overwrite imported or existing applications.
- [ ] Materialize the scaffold before the primary coding model starts.
- [ ] Inject project environment variables after scaffold creation and before server startup.
- [ ] Start one persistent development server immediately and emit the preview URL as soon as the shell is healthy.
- [ ] Keep the preview alive across edits and use framework hot reload/incremental compilation.
- [ ] Avoid an unconditional final `npm install`; install only when the manifest/lockfile changed or dependency integrity fails.
- [ ] Add bounded prewarming with cost controls rather than keeping unlimited idle sandboxes alive.
- [ ] Add a safe scaffold-recovery path that can recreate platform-owned files without touching user files.

#### Exit gate

- New benchmark projects show an interactive preview inside the Phase 2 p50/p95 target.
- Existing/imported projects follow the legacy preservation path unchanged.
- A preview restart does not mix `next dev` and `next start` artifacts.

### Phase 3 — Bounded, batched agent execution

**Goal:** Replace the open-ended 100-turn loop with a task-sized workflow.

#### TODO

- [ ] Introduce explicit internal stages: Understand → Inspect → Implement → Check → Verify → Finish.
- [ ] Allocate adaptive turn budgets by task complexity; start with 12–20 ordinary turns and a 30-turn complex ceiling.
- [ ] Keep a controlled continuation/checkpoint mechanism for genuinely unfinished work; do not silently claim completion at the cap.
- [ ] Add a bulk `read_files` tool with total-byte, file-count, binary, and path-safety limits.
- [ ] Add a transactional multi-file edit/patch tool that returns per-file diffs and fails safely on stale context.
- [ ] Execute independent read-only calls concurrently with a small concurrency limit.
- [ ] Keep mutations ordered; never parallelize writes that can conflict or commands that share processes/build output.
- [ ] Add unchanged-file read deduplication using content hashes.
- [ ] Require one deliberate context-gathering pass for ordinary tasks rather than repeated discovery.
- [ ] Replace the “3–4 files per turn” rule with byte/token-aware batching so small related files can be changed together safely.
- [ ] Add loop detection for repeated reads, identical commands, identical errors, and repeated preview checks.
- [ ] Define proportional verification budgets for small edits, new frontends, and full-stack builds.

#### Exit gate

- Ordinary benchmarks complete within 20 model turns without reducing pass rate.
- Repeated reads and identical checks fall by at least 70% from baseline.
- Tool parallelism never changes mutation order or leaks data between projects.

### Phase 4 — Context and token optimization

**Goal:** Stop rereading millions of tokens while preserving the information needed to work correctly.

#### TODO

- [ ] Keep a compact always-on system core; route detailed design/cloud guides through existing on-demand guide tools.
- [ ] Send only tools relevant to the current stage and enabled project capabilities.
- [ ] Compact after 6–8 turns, after a large bulk read, or when a token threshold is crossed—not only after 28 turns.
- [ ] Preserve the original request, verified constraints, active plan, changed-file hashes, unresolved errors, and check status during compaction.
- [ ] Replace old file bodies and command logs with bounded summaries plus stable references; retain recent error lines needed for repair.
- [ ] Truncate repetitive package/build output deterministically while preserving exit code, diagnostic codes, file paths, and relevant stack frames.
- [ ] Summarize older conversation history by project decisions rather than replaying up to 20 long messages verbatim.
- [ ] Use provider prompt caching when supported, but do not depend on it for correctness.
- [ ] Add context-integrity tests demonstrating that compaction retains pending requirements and never invents completed checks.

#### Exit gate

- Input tokens fall by at least 75% on the benchmark suite.
- Compacted runs produce equivalent or better correctness than full-context runs.
- The model cannot access another project’s summaries or tool results.

### Phase 5 — Incremental verification and one-build policy

**Goal:** Retain production confidence without repeatedly running cold production builds.

#### TODO

- [ ] During implementation, rely on the persistent dev server, targeted route probes, TypeScript incremental checks, and focused lint/tests.
- [ ] Run one clean production build after the candidate implementation is complete.
- [ ] Permit another production build only after a concrete fix to a failed build or verified runtime issue.
- [ ] Keep the mandatory clean `.next` boundary before production builds.
- [ ] Never share `.next` between `next dev` and `next start`; remount the preview after server/build revisions.
- [ ] Move migration verification ahead of the final build when schema changes are present.
- [ ] Make verification proportional:
  - [ ] Copy-only/local style edit: affected route and focused checks.
  - [ ] Component/route change: affected routes at relevant viewports.
  - [ ] New frontend: phone/tablet/desktop, primary interactions, states, console.
  - [ ] Full-stack app: production build, migrations, auth/session, API routes, storage/database paths, console.
- [ ] Add deterministic parsers for TypeScript, Next.js, package-manager, Drizzle, and common runtime diagnostics.
- [ ] Prevent finalization from reinstalling dependencies or repeating a check already completed against the same file/lock hashes.

#### Exit gate

- Successful runs average no more than 1.3 production builds.
- Build/runtime pass rates stay at or above baseline.
- Stale Server Action and client-manifest regressions remain covered.

### Phase 6 — Model routing, autofix, and critical-path cleanup

**Goal:** Use model intelligence where it adds value and deterministic code where it is faster and safer.

#### TODO

- [ ] Benchmark candidate coding models on successful-preview rate, turns, input tokens, latency, visual quality, and cost—not tokens/second alone.
- [ ] Route lightweight classification, summarization, and commit messages to deterministic logic or a smaller fast model.
- [ ] Keep implementation and difficult repair work on the best-performing coding/tool-use model.
- [ ] Add deterministic safe autofixes for known configuration and generated-artifact problems; require tests for every autofix.
- [ ] Keep model-driven fixes for ambiguous application logic; never apply broad speculative rewrites automatically.
- [ ] Generate an initial commit message deterministically from changed paths and summaries, or perform optional refinement after the user-visible build is ready.
- [ ] Move noncritical GitHub refreshes, analytics persistence, and artifact bookkeeping outside first-preview latency.
- [ ] Ensure background finalization is idempotent and visibly reports failures without rolling back a healthy preview.

#### Exit gate

- The selected model configuration beats the current model on time-to-verified-preview and pass rate across the full benchmark suite.
- Noncritical GitHub/finalization work no longer delays the first preview.
- Autofixers cannot modify user code outside their narrowly tested patterns.

### Phase 7 — Safe rollout and operational hardening

**Goal:** Introduce the new path without destabilizing production projects.

#### TODO

- [ ] Put scaffold bootstrap, bounded orchestration, context compaction, and one-build verification behind independent server-side feature flags.
- [ ] Add per-run architecture/version metadata so failures can be traced to a scaffold and orchestration version.
- [ ] Run shadow benchmarks before serving the new path to users.
- [ ] Roll out to internal/test accounts, then 5%, 25%, 50%, and 100% of eligible new projects.
- [ ] Hold each stage until latency, correctness, runtime-error, follow-up-fix, credit, and infrastructure-cost metrics meet gates.
- [ ] Preserve a one-click server-side fallback to legacy bootstrap/orchestration during the canary.
- [ ] Exclude imported repositories and unsupported frameworks until compatibility tests pass.
- [ ] Monitor sandbox start failures, template drift, package vulnerabilities, cache misses, model retries, and background-finalization failures.
- [ ] Document incident rollback: disable new scaffold version, pin prior manifest, drain warm pool, and route new builds to the last known-good path.
- [ ] Remove the legacy new-project path only after at least two weeks of stable full rollout; retain existing-project compatibility code.

#### Exit gate

- p50/p95 targets hold for two consecutive weeks at full rollout.
- Correctness and follow-up-fix rates are no worse than baseline.
- Rollback has been exercised successfully in staging.

## 6. Priority backlog

### P0 — Required for meaningful speed gains

- [ ] Stage-level telemetry and benchmark suite.
- [ ] Versioned Web base scaffold with lockfile and prewarmed dependencies.
- [ ] Early persistent preview.
- [ ] Bulk reads and transactional multi-file edits.
- [ ] Adaptive 12–30 turn budgets with loop detection.
- [ ] Context compaction and dynamic prompt/tool loading.
- [ ] One clean production build after incremental checks.

### P1 — Required for reliable production rollout

- [ ] Cloud feature overlays and deterministic profile selection.
- [ ] Proportional visual/runtime verification.
- [ ] Model benchmark and routing.
- [ ] Deterministic diagnostic parsing/autofix.
- [ ] Feature flags, canary controls, scaffold versioning, and rollback.

### P2 — Further optimization after targets are stable

- [ ] Bounded warm-sandbox pool by region.
- [ ] Shared content-addressed package store.
- [ ] Provider prompt-cache optimization.
- [ ] Background GitHub message refinement.
- [ ] Predictive profile prewarming based on aggregate, non-sensitive demand.

## 7. Important caveats and design decisions

1. **Do not put every dependency in every app.** Use the smallest sufficient profile to limit dependency surface, install weight, bundle complexity, and vulnerability exposure.
2. **A scaffold is not a universal rewrite.** It applies only to new projects. Existing and imported projects keep their framework, package manager, conventions, and dependency graph.
3. **Never bake credentials into artifacts.** Images and templates may contain adapter source and environment-variable names only. Values remain server-side and project-specific.
4. **Keep generated apps exportable.** Prefer ordinary source modules and standard packages. If a Cognix runtime package is introduced, pin it, publish compatibility policy, and provide an export-safe implementation.
5. **Template freshness becomes an operational responsibility.** Lockfiles require scheduled updates, compatibility tests, vulnerability monitoring, and rollbackable releases.
6. **Snapshots can hide portability problems.** Native modules and `node_modules` must match the sandbox OS, CPU architecture, Node ABI, and package-manager version.
7. **Warm capacity has a real cost.** Prewarming must be bounded by concurrency, region, demand, TTL, and budget; measure cost per successful build.
8. **Cloud provisioning remains variable.** Database/storage control-plane latency cannot be eliminated, so provision early and concurrently when safe.
9. **Do not lower the turn cap before adding batching and checkpoints.** A smaller cap alone converts slow completions into fast incomplete builds.
10. **Do not remove the clean-build safeguard.** Reduce build frequency instead. Clean artifacts, stable Server Action keys, server restart, iframe remount, and runtime probes remain mandatory at final verification.
11. **First preview and completion are different milestones.** Show useful progress early, but label verification honestly and keep publishing gated on final checks.
12. **Quality workflows must be proportional.** Design critique and multi-viewport checks remain deep for new apps/reference work and lightweight for localized edits.

## 8. Definition of done

This roadmap is complete only when:

- [ ] New projects begin from a tested Cognix scaffold without model-generated framework setup.
- [ ] Existing projects are preserved and follow an appropriate compatibility path.
- [ ] Normal builds no longer exhaust the agent-turn ceiling.
- [ ] Context and token use meet targets without lost requirements.
- [ ] Users receive an early interactive preview and an explicit verified-completion state.
- [ ] Successful runs normally perform one clean production build.
- [ ] Full-stack applications retain working database, auth, storage, responsive UI, accessibility, and runtime behavior.
- [ ] Benchmark p50/p95 latency and correctness gates hold in production for two weeks.
- [ ] Template, orchestration, and model versions are observable and rollbackable.

## 9. Recommended starting sequence

When implementation is authorized, start in this order:

1. Phase 0 telemetry and benchmarks.
2. Phase 1 scaffold spike and Web base profile.
3. In parallel: Phase 2 early preview and Phase 3 bulk/bounded agent loop.
4. Phase 4 context compaction.
5. Phase 5 verification consolidation.
6. Phase 6 model/autofix optimization.
7. Phase 7 controlled rollout.

Do not begin by simply changing `AGENT_MAX_TURNS`, removing production verification, or installing every package globally. Those changes can make the product appear faster while increasing incomplete builds, dependency risk, and production failures.
