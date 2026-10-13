# Pi model-routing extensions: competitive review

**Review date:** 2026-10-04  
**Audience:** maintainers deciding the next changes to pi-virtual-models.  
**Decision this supports:** choose improvements that increase routing trustworthiness and usefulness without making the package a workflow harness.  
**Status:** historical research snapshot, not a live feature inventory. Follow-up scope was subsequently approved in the conversation and is tracked in the [M001 brief](M001-CONTEXT.md) and [roadmap](M001-ROADMAP.md). Findings below describe the pre-M001 implementation; implementation status belongs in the roadmap.

## Executive conclusion

Our strongest position is **explicit, reusable routing policy with predictable constraints**, not an increasingly elaborate automatic cost optimizer.

We already have a useful combination: configurable LLM/native-classifier selectors, global and scoped automatic routes, hard effort constraints, deterministic explicit assignments, branch/task-aware native dispatch, context-separated routing UI, and optional role guidance. None of native routing, a reusable core, or expandable diagnostics is individually unique in this ecosystem.

Our largest weaknesses are now **task-context quality, explainability of rejected/failed decisions, and evidence of routing quality**. More selector backends or automatic fallback chains would not address those weaknesses.

Recommended sequence:

1. **Decision receipts plus `doctor`, `preview`, and `explain`.** Make failures and exclusions inspectable without silently invoking inference.
2. **A versioned routing evaluation/replay suite.** Establish whether either backend chooses suitable assignments, not just valid ones.
3. **Explicit task continuity and bounded task briefs.** Avoid treating “yes, do that” as a fresh, context-free task.
4. **Context/output-capacity admission.** Expose fit and compaction consequences before choosing, without secretly upgrading effort.
5. **Optional exact decision caching and switch-cost diagnostics.** Add these only with measurable benefit and strict invalidation.

Do not copy automatic tier downgrades, broad execution retries, tool activation, child orchestration, or provider-specific reasoning control into the core merely to match competitors' feature lists.

## 1. Method and evidence limits

### What was inspected

- Ten **published npm releases**, using the npm registry to establish exact versions, then version-pinned package source/README files from jsDelivr.
- Two additional **public Git-distributed reference extensions**, pinned to exact commits. They both name themselves `pi-jev-router` in their manifests, but they are **not** the npm package owned by `mejiasd3v`.
- Our current source and documented implementation, including the previously verified 69-test local baseline. Those tests establish mechanical behavior, not real model-selection accuracy.

Search results were discovery aids, not final evidence. This mattered: a search description characterized `mejiasd3v/pi-jev-router` as per-turn routing, whereas the inspected 0.5.0 README/source describe session pinning with optional monitoring/adaptive effort.

Remote source was downloaded to a temporary directory for inspection. No competing package was installed or executed, and no live routing or execution-model tests were run. Provider credentials were not inspected. This was a targeted architectural/source comparison, **not** an exhaustive security audit or runtime compatibility test of competitors. No relative savings, latency, accuracy or downstream task-success claim has been independently measured here.

“Present in source” means an inspected implementation path exists. README performance figures, benchmark claims and operational guarantees remain author-reported unless explicitly identified otherwise. Missing features below mean “not in the reviewed surface,” not proof that no branch or optional integration offers them.

### Version inventory

| Package / reference | Inspected snapshot | Primary focus |
| --- | --- | --- |
| `@yeliu84/pi-model-router` | 0.4.4 | Tiered profiles, heuristic/LLM advice, budgets and fallback |
| `@kylebrodeur/pi-model-router` | 0.3.0 | Upstream-style routing plus rate-limit recovery and integrations |
| `@alexeiled/pi-model-router` | 0.9.2 | More recent profile routing with bounded Jev/LLM advice and stronger continuation handling |
| `pi-router` — jiangge | 0.5.7 | Provider-channel reliability, circuit breakers and failover |
| `pi-tier-router` — rioliu | 0.3.0 | Native two-model routing, local heuristics and decision reuse |
| `pi-jev-model-router` — da-vinci-noob | 0.8.0 | Semantic judgments composed with budgets, cache guards and quotas |
| `pi-jev-router` — mejiasd3v | 0.5.0 | Session-pinned model/effort with advisory monitoring |
| `pi-smart-router` — beettlle | 1.2.0 | Larger routing/optimization platform with context-fit, economics and evaluation infrastructure |
| `pi-model-auto` — maynewong | 0.3.0 | Capability modes, quality/cost selection and one-way sticky upgrades |
| `pi-jev` — TheoOliveira | 0.7.0 | Broader Jev suite including opt-in model, tool and skill routing |
| `win4r/pi-jev-router` | `319a04482ab060268afe31ff29d51c77119114cd` | Explicit task boundaries, exact caching, diagnostics and conservative admission |
| `philippdubach/pi-jev-router` | `c4449af975a302275ba3aff89ff29b4c2476fa54` | Evaluation-informed Pareto selection and role policies; also includes orchestration |

Package versions were resolved from `https://registry.npmjs.org/<package>` on the review date; source references below pin the inspected releases. Additional forks were discovered, including `@kdejaeger/pi-model-router`, but not deeply reviewed. This is a representative comparison, not a complete ecosystem census.

**Compatibility caution:** the modern `@alexeiled` release declares Pi 1.0.2+ within 1.x, while our baseline is Pi 1.0.1. The win4r reference documents tests against older Pi 0.84.2/0.86.1. A design worth borrowing is not evidence that its package can be loaded unchanged into our host.

## 2. What the alternatives do well—and their trade-offs

### A. Profile/tier router family

**`@yeliu84/pi-model-router` 0.4.4** provides an approachable tier/profile model, keyword rules, phase memory, optional LLM intent classification, manual controls and fallback chains. Its source confirms `registerProvider` plus delegated streaming, rather than native `registerVirtualModel`. The classifier considers recent conversation text as well as the latest request. [S1]

Trade-offs visible in this snapshot:

- The routing function applies the budget downgrade after the pinned-tier branch. A high-tier pin can become medium when the budget condition is met. That is a different contract from our hard effort/manual-selection semantics.
- Keyword, length and phase rules are transparent, but not semantic correctness guarantees. A complex summary is not necessarily cheap work.
- The inspected `runClassifier` call supplies neither an explicit timeout nor the incoming AbortSignal. This is a concrete advantage of our bounded selector-call boundary, not a blanket claim about every fork.
- The provider layer owns stream forwarding, auth handling, fallback and context truncation. This is more compatibility-sensitive surface than our native-dispatch adapter.

**`@kylebrodeur/pi-model-router` 0.3.0** adds useful operational controls: rate-limit parsing, waits/fallbacks, restore controls, setup scaffolding and integrations. These solve availability and convenience problems our package deliberately does not own. However, its broader provider/recovery layer has a larger operational surface, and the published peer ranges target an older Pi generation. It should not be treated as evidence that all newer upstream/fork behavior is identical. [S2]

**`@alexeiled/pi-model-router` 0.9.2** is a materially stronger comparison than the older family snapshots. Source inspection confirms bounded advice, optional Jev and LLM paths, per-profile Jev approval, policy/config/branch checks on continuation reuse, validation after the network boundary, and sharing of in-flight Jev evaluations. Tool-result continuations do not invoke advisors. Its context builder separates current request, recent dialogue, and optional tool evidence. [S3]

What to learn: structured context admission, explicit advice outcomes/bypass reasons, and careful reuse boundaries. Trade-offs: it still owns a custom provider/streaming layer; advisor failure chooses a compatible baseline instead of our explicit abstention/error contract. The README's response/session counts demonstrate observed use, not independently measured savings or quality retention. We should **not** portray modern forks as simplistic or inherently unsafe.

### B. A native low-overhead router

**`pi-tier-router` 0.3.0** uses native virtual models and keeps one decision for a complete user-prompt/tool run. It tries local rules, a bounded decision-memory store, an LLM self-rating, then optional **native Pi classifier** execution. Its wizard and memory-status/reset controls are useful examples of reducing operational friction. [S4]

Trade-offs:

- Its primary contract is a flash/pro pair, not arbitrary domain roles with hard effort variants.
- The self-rating path uses the LLM's own numeric confidence to decide whether to skip Jev. That number is not established as a calibrated correctness probability by the inspected implementation.
- Similarity-based memory can reuse a decision for a different but lexically similar task. This may be a good optimization, but requires a quality-risk evaluation our current package does not have.
- Degraded routing may retain an old model or select another available chat model. Direct requests use flash. These favor availability/cost rather than our explicit-assignment/direct-target contract.

Conclusion: native registration is no longer a differentiator by itself. Borrow the attention to overhead and setup, not the confidence or fuzzy-cache semantics without evidence.

### C. Jev judgments plus operator controls

**`pi-jev-model-router` 0.8.0** has a particularly useful operator surface: preview, notify/confirm modes, revert, quota visibility, and durable expandable records for both decisions and skipped routing. Its code separates Jev task judgments from budget composition. Cache guards consider same-tier model changes as well as tier changes. [S5]

Trade-offs:

- It changes the active model with `setModel`, rather than maintaining our virtual selection/physical dispatch separation.
- It uses custom HTTP Jev execution, not our native classifier abstraction.
- Weighted complexity/capability scores, confidence guards, budget guards, specialists, neighbouring tiers and cache guards create substantial policy interaction. Some are helpful, but they are not interchangeable with a hard `:high` constraint.
- Budget pressure can reduce the selected tier. Cache preservation can retain a model different from the fresh semantic recommendation. Those actions are visible, but the semantics differ from ours.

An important detail: its `/jev-router why` documentation describes **rerunning** Jev. Our proposed `explain` should instead show the original receipt; a new paid evaluation should be a separately named action.

**`pi-jev-router` 0.5.0, mejiasd3v** makes a different, coherent trade-off: choose once and stay pinned. It provides bounded recent context, explicit privacy documentation, long-input chunking, fork suggestions rather than automatic model replacement, and optional skill/adaptive-effort behavior. Its source uses a custom provider and delegates generation. [S6]

What to learn: short follow-ups need context; pinning can be explicit; truncation/budget behavior should be visible. What not to copy indiscriminately: Vercel/TypeSafe coupling, potentially multiple chunk/retry evaluations, skill loading, or a special adaptive-reasoning path for one model family. Its README correctly warns that conversation/tool excerpts can contain secrets and that advisory costs are additional. Our smaller input boundary is an advantage, but its narrower context can also reduce routing quality.

### D. General optimization platforms

**`pi-smart-router` 1.2.0** is stronger than us in breadth: structured pipeline stages, context-fit filtering, cache-reprime calculations, outcome recording, calibration machinery and explainability. It also has a library API—reusability is not unique to us. Inspected source confirms concrete context-fit and cache-breakeven implementations, not just feature-list claims. [S7]

Trade-offs:

- Much larger integration/dependency surface: custom provider/delegation, local runtime/hardware probing, model artifacts, pricing and persistence. The published README notes native SQLite installation and model-weight downloads.
- Its README explicitly says stable API does **not** establish behaviorally proven cheap-tier routing, and lists Windows as experimental. That honesty should inform our own release language.
- Capability scores, priors and cache estimates still need appropriate data. More formulas do not make a router correct automatically.

Borrow context-fit diagnostics, evaluation discipline and machine-readable outcomes. Do not import the full hardware/local-inference/optimization platform into this project.

**`pi-model-auto` 0.3.0** offers a simpler economic contract: capability modes are separate from price; quality/cost selection chooses within a mode; ordinary lower-demand turns keep the warm model, and upgrades are generally one-way. The README explicitly discusses its own trade-offs and why earlier policy combinations became difficult to predict. [S8]

This predictability is attractive, but a session can remain on an expensive model after the difficult work is over. Benchmark-derived capability bands are not domain-specific role evidence, and fallback may cross modes. Its reusable API loads user configuration and quota state by default; our explicit-injection core is a cleaner boundary for consumers that must own those decisions.

### E. Provider reliability is a different routing problem

**`pi-router` 0.5.7, jiangge** is primarily a channel/failover router, not a semantic role selector. Its strengths include circuit breakers, cooldowns, persistent successful routes, explanatory commands, a configuration wizard and per-attempt observations. The inspected stream relay explicitly tracks whether output has committed and separates cancellation from ordinary failures. That is important engineering—not something to dismiss as “just a proxy.” [S9]

It also owns stream relay, context transfer, provider-channel selection and optional paid health probes. These are a different layer from choosing `wiki/edit:high`. Copying them would expand our responsibility substantially. Our package does not add fallback, but an operator-configured provider/proxy can still have its own routing behavior; “physical registry target” is not an end-to-end guarantee about an upstream service.

**`pi-jev` 0.7.0, TheoOliveira** provides a much broader opt-in suite: model/capability routing, thinking adjustment, tool/skill discovery, guards, compaction and orchestration. Its model router includes capability-fit and prefix-aware cost considerations. This demonstrates composition possibilities, but it is not a direct substitute for our narrow library. [S10]

The suite's tool activation, guards and orchestration are deliberately outside our contract. **Role guidance in our package is not tool permission management**, and this review does not recommend adding such permissions.

### F. Two valuable Git reference implementations

**`win4r/pi-jev-router`** is the closest conceptual reference for several of our gaps. It distinguishes task boundaries from conversational follow-ups, accepts an explicit brief, defaults to shadow mode with remote classification disabled, uses exact request/policy hashing, exposes exclusions, and checks context/output capacity. Its reusable router does not spawn work. Source confirms the cache key and admission checks. [S11]

It is not a drop-in target architecture: it uses its own Jev client, tier/risk composition, active-model switching and persistent health coordination. Its documented 15/16 result concerns a small synthetic judgment/rule dataset, **not downstream coding success**, and its tested Pi versions are older than ours. The important lesson is explicit task context and inspectable decisions, not its particular thresholds.

**`philippdubach/pi-jev-router`** provides useful evaluation discipline: separate classifier evaluation and policy replay, per-role model evidence, independently checked task verifiers, explicit failures/timeouts and documented adjudications. Its README distinguishes routing recommendations from the model that actually ran. [S12]

Trade-offs: OpenRouter-specific data/prior assumptions, very small evidence cells in some roles, automatic gate relaxation/budget substitution, persisted context excerpts and a considerably broader worker/worktree orchestration surface. Its measured examples are author-reported and workload-specific. Borrow the evaluation methods, not universal model rankings or the execution harness.

## 3. Our strengths, stated narrowly

| Strength | What it actually guarantees | Important limit |
| --- | --- | --- |
| One decision contract for LLM and native classifier | Both select from the same filtered role/effort criteria; no fabricated LLM confidence required | Does not make their decisions equally accurate |
| Hard namespace/effort constraints | Offered choices and accepted/revalidated assignments remain within the requested scope and effort | A valid choice can still be semantically unsuitable |
| Native dispatch and sticky continuations | Pi owns generation; virtual selection remains separate from physical dispatch | Native routing is also used elsewhere; child-launch compatibility remains unverified |
| Explicit, side-effect-free core | Config/inventory are supplied by consumers; importing it does not discover config, route or mutate a session | Native adapter assumptions must still be tested across Pi releases |
| Single-use decision handles and revalidation | Serialized handles are not authority; stale policy/target/scope assignments are rejected | Consumer restrictions must be supplied consistently; this is not a security sandbox |
| Narrow default data sharing | Native selection gets bounded latest-user text, truncation and image-presence flags | Follow-ups and long tasks can lose decisive context |
| UI/context separation and role guidance | Diagnostics stay out of context; only configured guidance and opt-in assignment metadata are injected transiently | It is prompt guidance, not enforced behavior or permissions |
| Fail-closed selection with no added fallback | Errors, abstention and unavailable constrained targets do not silently become another assignment | Availability is worse during selector/provider outages; upstream proxies are opaque |

Local evidence: [core](../src/core/index.ts), [policy types](../src/core/types.ts), [native adapter](../src/pi-adapter.ts), [execution context](../src/execution-context.ts), [selector boundary](../src/selector-call.ts), [routing renderer](../src/routing-notice.ts), and [implementation notes](IMPLEMENTATION.md). These local references describe the review snapshot and can change with later work.

## 4. Our weaknesses and ranked gaps

Priority is based on fit with our contract and likely operator value, not competitor feature count. Effort estimates are relative design/implementation scope, not delivery promises.

### P0-A — Decision receipts, exclusion reasons and operator diagnostics

**Current gap:** `Eligibility.reason` exists, but the core reduces inventory results to a boolean. `NO_CANDIDATES` and `INELIGIBLE` therefore lack a complete exclusion explanation. Our UI describes successful selection/dispatch intent, not why alternatives were removed or why a selection failed. Selector accounting records returned metadata; it does not provide a complete count of started, timed-out and abandoned attempts. Missing usage must not look like zero cost.

**Learn from:** modern `@alexeiled` advice outcomes; win4r exclusions/doctor/explain; `pi-jev-model-router` skipped-decision entries; `pi-router` per-attempt status. [S3][S5][S9][S11]

**Proposed scope:** a bounded, versioned decision receipt with selection/scope, eligible and excluded choices, stable reason codes, selected target, selector attempt outcome, timing, known/unknown usage, and later observed dispatch outcome where available. Keep raw prompts, provider payloads and chain-of-thought out by default.

Operator surfaces:

- `doctor`: validate current config, identity, auth configuration, capabilities and selector availability; **no paid inference**.
- `preview`: evaluate a supplied task without changing model, guidance, sticky state or pending execution. Be explicit if it will call a paid selector.
- `explain`: show the original receipt, **without rerunning the selector**.

We already have `prepare`, `select` and non-dispatching router tools. The missing part is the operator-facing diagnostic surface and a complete explanatory result—not a new resolver.

**Acceptance:** missing credentials, excluded namespace/effort, unsupported input, abstention, malformed JSON, timeout and stale policy are distinguishable; unknown usage stays unknown; explain has zero selector calls; preview never applies proposed role guidance to the parent. **Scope:** medium. **Recommendation:** first slice.

### P0-B — Routing-quality evaluation and reproducible replay

**Current gap:** our fake-provider tests validate invariants, not whether a real LLM/Jev chooses the right policy. There is no labeled routing corpus, selector comparison, drift check or downstream-quality baseline.

**Learn from:** win4r's separation of live judgments from policy replay; philippdubach's verifier-backed evaluation and explicit evidence limits; pi-smart-router's calibration/outcome infrastructure. [S7][S11][S12]

**Proposed scope:** start with a small versioned corpus of roughly 30–50 deliberately varied cases, including acceptable-choice sets rather than assuming one universally optimal answer. Cover ambiguous follow-ups, long prompts with critical requirements at the end, role boundaries, fixed effort, image-required work, no suitable candidate and adversarial task text. Add deterministic replay from recorded answers separately from explicitly authorized live evaluation.

Measure:

- constraint violations separately from semantic mismatch;
- under-routing and abstention rates, not just overall accuracy;
- selector errors, p50/p95 added latency, reported/unknown cost;
- switch frequency and observed cache tokens;
- later, held-out task outcomes against an explicit fixed-model baseline.

Freeze labels before a run, preserve policy/selector versions, and keep tuning cases separate from held-out cases. A replay of old judgments is not a fresh model evaluation. A high-confidence classifier answer is not a success label. Live runs require explicit cost/data approval.

**Acceptance:** offline evaluation is reproducible without credentials; LLM/Jev use identical offered policies/state; reports do not equate valid JSON with suitable routing; negative-control verifiers catch plausible wrong outputs when downstream tests are added. **Scope:** medium. **Recommendation:** establish before adding routing heuristics.

### P0-C — Explicit task continuity and bounded task briefs

**Current gap:** tool continuations are sticky, but a new user message triggers a new selection from only the first 3000 characters of the latest user text. “Yes, implement option two” lacks option two. A long task can put its decisive requirement beyond the transmitted prefix. `taskTruncated` makes truncation visible to the selector but does not recover that requirement.

**Learn from:** win4r's explicit task boundary/brief; modern `@alexeiled` structured context; mejiasd3v's context and long-input policies. [S3][S6][S11]

**Proposed scope:** preserve today's behavior by default, then offer an explicit task-boundary mode and a bounded caller/operator-supplied brief. Consider an opt-in recent-dialogue context policy, but do not silently upload tool results, repository contents, system prompts or role guidance. Long-input treatment should be a declared policy, not an accidental prefix cut.

Avoid relying solely on a keyword list such as “continue”: “continue with the security review instead” can be a genuine task change. Prefer explicit boundaries and make ambiguous cases inspectable. A new capability/constraint requirement must still invalidate an unsuitable sticky assignment.

**Acceptance:** follow-ups preserve task meaning when a brief is provided; new-task reset clears previous brief/assignment; branch/reload behavior is specified; explicit user changes always win; data budgets and truncation policy are visible; selectors still cannot widen hard constraints. **Scope:** medium. **Recommendation:** next behavioral improvement, informed by the evaluation corpus.

### P1-A — Context and output-capacity admission

**Current gap:** the native inventory checks physical chat identity, configured auth and text/image support, but not request-size/output-reserve requirements. Pi can compact after routing; that is useful protection, but not the same as choosing with awareness of compaction cost or avoiding lossy handoffs. [Local native adapter](../src/pi-adapter.ts)

**Learn from:** pi-smart-router's context-fit stage and win4r's explicit capacity exclusions. [S7][S11]

**Proposed scope:** consumer-supplied size estimates/output reserve and a declared `allow-compaction` versus `must-fit` policy. Treat unknown capacity explicitly. Report a target's fit/compaction consequence in preview. Tool-calling support, if added, is a **model capability requirement**, not a tool permission list.

**Acceptance:** a hard effort pin never turns into an implicit larger-model upgrade; must-fit rejects inadequate targets with reasons; unknown limits are visible; native compaction remains Pi-owned; estimators are labeled estimates. **Scope:** medium. **Recommendation:** prioritize for long sessions and heterogeneous model fleets.

### P1-B — Selector overhead and cross-turn switching visibility

**Current gap:** every new automatic user turn normally pays for a selector call. We do not show a switching-cost estimate or offer cross-turn task-affinity controls beyond explicit pins. Persisting selector totals does not establish net savings.

**Learn from:** pi-tier-router's emphasis on overhead, modern `@alexeiled` single-flight reuse, win4r's exact cache and observed warm ratios, and cache diagnostics in the Jev/smart routers. [S3][S4][S5][S7][S11]

**Proposed scope:** measure first. If worthwhile, add opt-in bounded in-memory **exact** caching keyed by the complete permitted request, offered criteria, policy revision and selector configuration. Revalidate eligibility on every reuse; do not cache failures or reuse a consumed decision handle. Add visible estimates of switching cost before considering automatic hold-down behavior.

Do not skip classification merely because one candidate remains: `__abstain__` is still meaningful. A sole candidate can be unsuitable. Any shortcut must explicitly preserve or deliberately opt out of that semantic check.

**Acceptance:** changed criteria/brief/selector/scope invalidate reuse; cached answers cannot resurrect revoked targets; storage is bounded and clearable; unknown prices are not zero; estimates are not called measured savings. **Scope:** medium. **Recommendation:** after receipts/evaluation/task context.

### P1-C — Setup and compatibility confidence

**Current gap:** hand-authoring a complete role/effort catalog and matching criteria is demanding. We have useful missing-config help, but no catalog-aware scaffolder or doctor. We remain an unpublished/private local package with a single pinned host baseline and no verified virtual-child launch integration.

**Learn from:** the setup wizards in pi-tier-router and pi-router; the modern fork's declared host floor and startup tests. [S3][S4][S9]

**Proposed scope:** opt-in config scaffolding that uses Pi's registry, never overwrites silently, never probes paid endpoints, and clearly distinguishes inherited versus overridden selectors. Add supported-Pi-version tests and a collision/duplicate-install diagnostic. Decide license/publication separately.

**Acceptance:** a fresh user can create a minimal scoped route with valid matching criteria; no global settings, credentials or tool permissions are rewritten; supported versions are stated from tests rather than wildcard peers. **Scope:** small–medium, plus an independent child-compatibility investigation.

## 5. What not to copy now

| Feature | Why it is not a current gap to fill |
| --- | --- |
| Automatic budget-driven downgrades | Can contradict effort pins and role suitability. A future consumer may supply a budget constraint, but the core must not reinterpret explicit effort. |
| Broad provider/model fallback chains | Availability is valuable, but replay/stream-commit/cost semantics belong in a separately designed execution layer. |
| Fuzzy semantic decision memory | Similar wording does not imply identical requirements; evaluate exact caching first. |
| Mandatory numeric LLM confidence | Uncalibrated self-report adds false precision; preserve optional native diagnostics instead. |
| Automatic tool activation/permission policy | Explicitly outside this package. Role guidance remains soft instructions. |
| Worker spawning, worktrees, orchestration and task verification ownership | These are consumer/harness responsibilities, even when evaluation tools exercise representative tasks. |
| Provider-specific adaptive reasoning updates | Couples generic routing to one provider's transport and cache semantics. |
| Unsolicited probes or model/catalog downloads | Adds cost, network/storage behavior and lifecycle ownership not required for explicit policy selection. |
| Automatic project config layering | Still needs a separate trust/precedence design; convenience alone is insufficient. |

An explicit inventory/health integration may eventually help avoid unhealthy targets without owning retries. That is a separate proposal, not a recommendation to make fail-open routing the default.

## 6. Conclusions and proposed follow-up slices

**Keep:** hard pins, scoped candidates, interchangeable selectors, native dispatch, explicit library inputs, minimal default sharing, non-context diagnostics and consumer-owned execution.

**Improve first:** receipts/diagnostics → evaluation/replay → task continuity/briefs. These make current behavior easier to inspect and improve before adding another policy mechanism.

Suggested independently reviewable work:

1. **Explainable decisions:** structured exclusion/attempt receipts and zero-inference doctor/explain.
2. **Safe preview:** build on existing selection primitives; separate proposal from execution and disclose selector cost.
3. **Evaluation foundation:** fixed corpus, offline replay, explicit optional live harness and report format.
4. **Task context:** opt-in explicit boundaries/briefs, with branch and privacy tests.
5. **Fit and economics:** capacity diagnostics first; exact caching/switch-cost visibility only after measurements justify them.

These are recommendations for user approval, not newly scheduled implementation work. A bounded shadow mode is worth considering after preview: it must declare the actual execution baseline, never apply proposed role guidance, and record proposed versus executed assignments separately. “Shadow” means no execution change, **not** necessarily zero selector cost.

The conclusion is not “ours is better.” It is: **ours has a strong constrained-routing foundation; other projects offer better operational visibility, task awareness and evaluation practices that we should adapt selectively.**

## 7. Primary-source references

Code and CDN README links below pin the reviewed version or commit. Catalog pages are discovery/publication references and can change. Package directories also contain their published manifests. README statements are not independent benchmarks.

- **[S1] Upstream tier router:** [README 0.4.4](https://cdn.jsdelivr.net/npm/@yeliu84/pi-model-router@0.4.4/README.md), [routing decisions and classifier](https://cdn.jsdelivr.net/npm/@yeliu84/pi-model-router@0.4.4/extensions/routing.ts), [provider and delegation](https://cdn.jsdelivr.net/npm/@yeliu84/pi-model-router@0.4.4/extensions/provider.ts). Relevant functions: `decideRouting`, `runClassifier`; provider budget/pin/classifier ordering.
- **[S2] Operational fork:** [published package page](https://pi.dev/packages/%40kylebrodeur/pi-model-router), [0.3.0 provider](https://cdn.jsdelivr.net/npm/@kylebrodeur/pi-model-router@0.3.0/extensions/provider.ts), [rate-limit handling](https://cdn.jsdelivr.net/npm/@kylebrodeur/pi-model-router@0.3.0/extensions/rate-limit.ts), [manifest](https://cdn.jsdelivr.net/npm/@kylebrodeur/pi-model-router@0.3.0/package.json).
- **[S3] Modern profile/advisor fork:** [README 0.9.2](https://cdn.jsdelivr.net/npm/@alexeiled/pi-model-router@0.9.2/README.md), [provider](https://cdn.jsdelivr.net/npm/@alexeiled/pi-model-router@0.9.2/extensions/provider.ts), [structured context](https://cdn.jsdelivr.net/npm/@alexeiled/pi-model-router@0.9.2/extensions/context.ts), [manifest](https://cdn.jsdelivr.net/npm/@alexeiled/pi-model-router@0.9.2/package.json). Relevant code: continuation eligibility, `runJevSingleFlight`, post-advice `available()` check, `buildJevContext`.
- **[S4] Native tier router:** [README 0.3.0](https://cdn.jsdelivr.net/npm/pi-tier-router@0.3.0/README.md), [implementation](https://cdn.jsdelivr.net/npm/pi-tier-router@0.3.0/extensions/index.ts), [published tests](https://cdn.jsdelivr.net/npm/pi-tier-router@0.3.0/extensions/auto-router.test.ts). Relevant functions: `chooseRating`, `rateWithJev`, `disabledRoute`, `routeVirtual`.
- **[S5] Jev model router:** [README 0.8.0](https://cdn.jsdelivr.net/npm/pi-jev-model-router@0.8.0/README.md), [decision policy](https://cdn.jsdelivr.net/npm/pi-jev-model-router@0.8.0/extensions/pi-jev-model-router/router.ts), [commands/rendering](https://cdn.jsdelivr.net/npm/pi-jev-model-router@0.8.0/extensions/pi-jev-model-router/index.ts), [Jev transport](https://cdn.jsdelivr.net/npm/pi-jev-model-router@0.8.0/extensions/pi-jev-model-router/jev.ts).
- **[S6] Session-pinned Jev router:** [README 0.5.0](https://cdn.jsdelivr.net/npm/pi-jev-router@0.5.0/README.md), [implementation](https://cdn.jsdelivr.net/npm/pi-jev-router@0.5.0/index.ts). This is the npm package associated with **mejiasd3v**, not either Git reference below.
- **[S7] Smart-router platform:** [README 1.2.0](https://cdn.jsdelivr.net/npm/pi-smart-router@1.2.0/README.md), [context fit](https://cdn.jsdelivr.net/npm/pi-smart-router@1.2.0/src/domain/routing/context-fit.ts), [cache breakeven](https://cdn.jsdelivr.net/npm/pi-smart-router@1.2.0/src/domain/pinning/cache-breakeven.ts), [outcome recording](https://cdn.jsdelivr.net/npm/pi-smart-router@1.2.0/src/infrastructure/telemetry/outcome-recorder.ts), [calibration](https://cdn.jsdelivr.net/npm/pi-smart-router@1.2.0/src/domain/routing/isotonic-calibrator.ts), [extension setup](https://cdn.jsdelivr.net/npm/pi-smart-router@1.2.0/.pi/extensions/smart-router/extension-setup.ts).
- **[S8] Capability-mode router:** [README 0.3.0](https://cdn.jsdelivr.net/npm/pi-model-auto@0.3.0/README.md), [core](https://cdn.jsdelivr.net/npm/pi-model-auto@0.3.0/src/router-core.ts), [extension](https://cdn.jsdelivr.net/npm/pi-model-auto@0.3.0/src/index.ts). `resolveRouteModel` demonstrates default configuration/quota reads.
- **[S9] Channel router:** [README 0.5.7](https://cdn.jsdelivr.net/npm/pi-router@0.5.7/README.md), [route executor](https://cdn.jsdelivr.net/npm/pi-router@0.5.7/core/route-executor.ts), [stream relay](https://cdn.jsdelivr.net/npm/pi-router@0.5.7/core/stream-relay.ts), [circuit breaker](https://cdn.jsdelivr.net/npm/pi-router@0.5.7/reliability/circuit-breaker.ts).
- **[S10] Broader Jev suite:** [README 0.7.0](https://cdn.jsdelivr.net/npm/pi-jev@0.7.0/README.md), [model router](https://cdn.jsdelivr.net/npm/pi-jev@0.7.0/src/model-router.ts), [manifest](https://cdn.jsdelivr.net/npm/pi-jev@0.7.0/package.json). The inspected npm release points to **TheoOliveira/pi-jev**; similarly named repositories must not be conflated.
- **[S11] Task-boundary reference:** [pinned README](https://github.com/win4r/pi-jev-router/blob/319a04482ab060268afe31ff29d51c77119114cd/README.md), [classifier/cache](https://github.com/win4r/pi-jev-router/blob/319a04482ab060268afe31ff29d51c77119114cd/src/classifier.ts), [admission/policy](https://github.com/win4r/pi-jev-router/blob/319a04482ab060268afe31ff29d51c77119114cd/src/policy.ts), [validation record](https://github.com/win4r/pi-jev-router/blob/319a04482ab060268afe31ff29d51c77119114cd/docs/validation.md), [replay](https://github.com/win4r/pi-jev-router/blob/319a04482ab060268afe31ff29d51c77119114cd/scripts/replay.ts).
- **[S12] Evaluation-informed Pareto reference:** [pinned README](https://github.com/philippdubach/pi-jev-router/blob/c4449af975a302275ba3aff89ff29b4c2476fa54/README.md), [selector](https://github.com/philippdubach/pi-jev-router/blob/c4449af975a302275ba3aff89ff29b4c2476fa54/src/selector.ts), [evidence scoring](https://github.com/philippdubach/pi-jev-router/blob/c4449af975a302275ba3aff89ff29b4c2476fa54/src/evidence.ts), [replay](https://github.com/philippdubach/pi-jev-router/blob/c4449af975a302275ba3aff89ff29b4c2476fa54/eval/replay.ts).
