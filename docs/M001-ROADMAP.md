# M001 — Explainable and task-aware routing roadmap

This standalone project-local roadmap implements the approved sequence. It does not activate GSD automation, authorize delegation or authorize live provider evaluation. See [milestone brief](M001-CONTEXT.md) and [research](MODEL-ROUTING-COMPETITIVE-REVIEW.md).

## Vision

Make routing decisions observable and evaluable before changing their behavior. Then improve task continuity and capacity admission without turning the router into a workflow harness.

## Success Criteria

Operators can diagnose a failed route, preview without execution changes and explain without new inference. Maintainers can replay labeled cases offline. Explicit opt-in context controls address follow-ups; capacity constraints preserve hard pins. An interactive advisor helps operators express their own routing/cost preferences using discovered models and safe namespace proposals; no universal savings proof is required.

## Key Risks

Diagnostic data leaks; confusing invocation with network/billing success; incomplete task reset/branch semantics; uncalibrated quality claims; unknown capacity/pricing treated as safe/free; observer failures changing routing behavior.

## Proof Strategy

Use pure core tests plus isolated real-Pi SDK/RPC sessions with fake providers. Separate mechanical invariants from semantic quality evaluations. Live tests require explicit approval; none run automatically. Preserve the initial 69 tests and require fresh full verification for each implementation slice.

## Verification Classes

- Contract: immutable bounded receipts, authority checks, replay and constraint behavior.
- Integration: native selection, tools, transcript entries, commands, branch/reload/resume and context isolation.
- Operational: live quality/cost comparisons are optional, separately authorized, and not claimed from mocks.

## Slices

- [x] **S01: Explainable decision records** `risk:medium` `depends:[]`
  > After this: a library caller or Pi operator can inspect configured candidate exclusions and terminal selector outcomes for a successful or failed decision without exposing task text or changing routing.
  - Add a bounded versioned receipt contract and explicit optional core observation.
  - Preserve stable native inventory exclusion reasons; retain successful usage observations even when an answer is rejected.
  - Persist UI-only native/tool receipts, render failed decisions with expandable details, and expose invocation/unknown-usage counts separately from existing reported usage.
  - Prove privacy, observer isolation, failure classification, concurrency attribution and no duplicate success notices.
  - **Status:** complete, 2026-10-04. `npm run verify` passed 84 tests (69 baseline + 15 new), typecheck, JS/declaration build and package/documentation checks. No live inference. See [S01 completion record](M001-S01-SUMMARY.md).

- [x] **S02: Doctor, preview and explain** `risk:medium` `depends:[S01]`
  > After this: an operator can validate setup without inference, preview a task without switching execution, and inspect the original receipt without rerunning the selector.
  - Define command parsing, no-inference/cost disclosure, receipt lookup and headless behavior.
  - Preview must not mutate active model, task state, parent guidance or coordinator handles; its records must be distinguishable from execution.
  - Add registry-based scaffolding only if it fits this bounded UX slice; otherwise document a separate small follow-up.
  - **Status:** complete. `npm run verify` passed 98 tests (84 existing + 14 new), typecheck, JS/declaration build and package/documentation checks. Headless JSON delivery and non-mutation verified with isolated SDK/CLI fixtures; no live inference. Scaffolding deferred. See [S02 completion record](M001-S02-SUMMARY.md).

- [x] **S03: Offline routing evaluation and replay** `risk:medium` `depends:[S01]`
  > After this: maintainers can run a versioned synthetic corpus and replay recorded answers without credentials, reporting constraint compliance separately from suitability.
  - Freeze approximately 30–50 diverse cases with acceptable-choice sets and split tuning/holdout cases.
  - Persist input-policy/selector versions explicitly in evaluation artifacts, not ordinary diagnostic receipts.
  - Define opt-in live execution separately; do not claim quality/cost results from fixture selectors.
  - **Status:** complete. Frozen 40-case corpus (20 tuning / 20 public holdout), bound recorded-answer fixtures, offline CLI, separate mechanical/suitability metrics and implementation provenance. `npm run verify` passed 108 tests, typecheck, build and package checks including 40 compiled replay cases. Live capture remains unimplemented and separately authorized. See [S03 completion record](M001-S03-SUMMARY.md) and [evaluation workflow](EVALUATION.md).

- [x] **S04: Bounded dialogue and optional session affinity** `risk:high` `depends:[S02,S03]`
  > After this: an operator can explicitly admit bounded dialogue and keep follow-ups on one assignment, with manual reselection and predictable branch/reset behavior.
  - Preserve the current per-user-turn and latest-user-prefix defaults; recent user/assistant context is opt-in, deterministic and bounded.
  - Specify context privacy, limits, manual-selection precedence and reload/resume/fork lifecycle before coding; revalidate every affinity reuse.
  - Make long-input treatment explicit (head-tail, prefix or rejection) and test critical suffix requirements and serialized-state limits.
  - Do not send tools, files, system/custom messages, reasoning or compacted-away history. Defer durable briefs, automatic summaries, inferred task boundaries and coordinator fallback.
  - **Status:** complete under the user-approved narrowed scope. `npm run verify` passed 128 tests (108 existing + 20 new), typecheck, build, recursive documentation/package checks and 40 compiled offline replay cases. Both fake selector backends, privacy/budget limits and native lifecycle/reselection are covered; no live inference. See [ADR 0001](adr/0001-bounded-dialogue-and-affinity.md) and [S04 completion record](M001-S04-SUMMARY.md).

- [x] **S05: Context/output-capacity admission** `risk:medium` `depends:[S01,S03]`
  > After this: a caller can require estimated execution-input/output fit or permit consumer-owned compaction, with explicit exclusions and unknown-limit behavior rather than implicit upgrades.
  - Use explicit caller estimates, output reserve and current inventory limits. Native input is unknown by default; Pi's full-request heuristic is opt-in and pre-transform, not a provider tokenizer.
  - Retain requirements in prepared/assigned state and revalidate current limits/fresh native input on affinity reuse. Do not mutate output/thinking/compaction settings.
  - Keep hard effort/scope constraints authoritative. Permitted compaction is not proof of enablement/success; estimated fit does not disable host compaction or guarantee a later transformed payload.
  - **Status:** complete. `npm run verify` passed 149 tests (128 existing + 21 new), typecheck, build, documentation/package checks and 40 compiled offline replay cases. No generation/compaction settings changed and no live inference ran. See [ADR 0002](adr/0002-capacity-is-admission-not-execution.md), [capacity guide](CAPACITY.md) and [S05 completion record](M001-S05-SUMMARY.md).

- [x] **S06: Interactive routing-policy advisor** `risk:medium` `depends:[S02,S03,S04,S05]`
  > After this: a new or existing operator can discover local models/prices, refine terminology and requirements through a probing interview, and explicitly approve a validated namespace proposal without changing unrelated policy or workflow permissions.
  - Adapt grilling and domain-modeling into a portable bundled skill: decision-tree frontier rounds, recommendations, precise vocabulary, edge cases and shared-understanding confirmation.
  - Discover physical chat/classifier identities, configured-auth presence, reported prices/unknowns, input/capacity limits and existing settings without credentials, catalog refresh or inference.
  - Offer optional source-backed task-fit research after workload discovery: benchmark/practitioner evidence, explicit consent and sanitized queries, relevance/version caveats, skip/unavailable paths, and a return to the interview before drafting. Host web capabilities are used; the local advisor tool remains network-free.
  - Validate namespace-only drafts, show changes/full config, preserve root/unrelated settings, and require user-command application with bounded ephemeral drafts, stale-file checks and backups.
  - Test first-run and existing-policy flows, privacy/non-mutation, schema/registry rejection and apply lifecycle. Conversational quality and paid evaluation remain separately assessed.
  - Caching/switch suppression are explicitly deferred. Existing usage/latency diagnostics remain; savings measurements are not a prerequisite.
  - **Status:** complete. `npm run verify` passed 182 tests (163 existing + 19 advisor tests), typecheck, JS/declaration build, Pi skill discovery, documentation/package checks and 40 compiled replay cases. No paid inference or live interview-quality claim. See [S06 completion record](M001-S06-SUMMARY.md) and [advisor guide](ADVISOR.md).

- [ ] **S07: Integrated lifecycle and compatibility acceptance** `risk:medium` `depends:[S02,S03,S04,S05,S06]`
  > After this: the assembled library/native extension passes the integrated acceptance scenarios and states exactly which host versions and behaviors were verified.
  - Cover tools, transient guidance, physical dispatch, direct compaction, retry, reload, branch/fork/resume and diagnostic persistence together.
  - Verify collision/duplicate-install diagnostics and document supported host versions from actual tests.
  - Child-launch compatibility, publication/license and live-quality claims remain separate unless explicitly authorized.

## Definition of Done

A slice has a demonstrated public behavior, regression tests, current documentation and a fresh passing `npm run verify`. Update its status only after verification. No claim of live semantic quality, end-to-end savings or child compatibility follows from this milestone's fake-provider tests.

## Requirement Coverage

R1/R2 → S01; R3 → S02; R4 → S03; R5 → S04; R6 → S05; R8 (interactive policy construction) → S06; R7 → every slice and S07.

## Horizontal Checklist

- [ ] Hard constraints and single-use authority preserved.
- [ ] Diagnostics remain bounded and outside model context.
- [ ] Unknown usage/capacity is explicit.
- [ ] No hidden fallback or execution ownership expansion.
- [ ] Side-effect-free core imports and backward-compatible existing call sites.
- [ ] Native/tool/library behavior documented and verified.

## Boundary Map

- **S01 → S02/S03:** versioned immutable `DecisionReceipt`, stable candidate/outcome codes and operation correlation; bounded observer seam in `src/core`; native custom entries separate from assignments and execution-context messages.
- **S02/S03 → S04:** non-mutating preview plus an evaluation baseline; explicit task-context state must not enter ordinary receipt payloads.
- **S01/S03 → S05:** inventory assessments and replayable constraints; capacity adds exclusions without modifying accepted effort/scope.
- **S02/S03/S04/S05 → S06:** safe diagnostics, scenario-based policy checks, and accurate context/capacity boundaries inform the advisor; no paid inference or runtime policy changes are implicit.
- **All → S07:** tested public APIs, UI-only receipts, documented lifecycle and explicitly unverified operational claims.

## Execution Notes

The Pi 1.2.0 compatibility follow-up upgrades the pinned host baseline and adds targeted lifecycle/catalog/compaction interoperability coverage; see [compatibility guidance](COMPATIBILITY.md). It does not complete S06's advisor workflow or all of S07's integrated/collision acceptance requirements.

Planning and S01–S06 are complete; no external issues or GSD state were created. S04 delivered the narrower LiteLLM-inspired context/affinity scope; durable briefs and automatic coordinator handoffs are deferred. S05 delivered qualified estimated capacity admission, not execution-budget control. S06 delivered the user-approved advisor scope rather than a savings-proof or cache optimization gate; S07 remains pending. Per-user-turn routing remains the compatibility default. Live inference remains separately gated.
