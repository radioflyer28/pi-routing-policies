# M001 — Explainable and task-aware routing

## Project Description

Improve pi-virtual-models from a mechanically validated router into an inspectable, evaluable routing component. Preserve its standalone library/native-extension architecture and explicit role, namespace and effort constraints. This is project-local planning, not activation of GSD or another workflow engine.

## Why This Milestone

The competitive review found that task context, failure explanations and quality evidence are more valuable gaps than additional selector backends. Operators need to know why a route was offered or rejected, evaluate proposals without applying them, and keep a multi-message task coherent without silently uploading history.

## User-Visible Outcome

An operator can inspect a routing failure with structured reasons, run a no-inference configuration check, preview a task without changing execution, and explain a recorded decision without paying for another selector call. Maintainers can replay labeled routing cases offline. Operators can opt into bounded dialogue and session affinity with explicit reselection, and inspect estimated execution-input/output admission against observed model limits.

## Completion Class

Integration. Core contracts, native Pi session behavior, transcript rendering and tool interfaces require end-to-end fake-provider tests. Live routing-quality or savings claims require separately authorized operational evaluation and are not milestone completion prerequisites.

## Final Integrated Acceptance

- Existing explicit/scoped/global routing behavior remains valid, including reload, resume, forks, direct requests, cancellation and tool continuations.
- A failed automatic selection yields a bounded durable record distinguishing unavailable candidates, abstention, malformed answers, timeout and cancellation; unknown charges remain unknown.
- Doctor and explain never call a selector; preview may call one only under documented consent/cost semantics and never applies its model, guidance or sticky state.
- Offline replay runs without credentials and separates suitability labels from hard-constraint checks. Live evaluation remains disabled by default.
- Opt-in bounded dialogue and session affinity have explicit privacy, reselection and branch-lifecycle behavior; the existing per-user-turn/latest-user default remains compatible.
- Capacity constraints produce explicit fit/unknown/compaction consequences without widening scope or effort.
- Optimization is delivered only when measurements justify it; otherwise it remains explicitly deferred.

## Architectural Decisions

### Preserve routing authority and consumer ownership

Diagnostics and future context improvements must not widen offered choices, alter manual pins, introduce provider fallback, or launch work. The consumer continues to own permissions, workflow state and verification. Reject copying broad optimization/orchestration platforms merely for feature parity.

### Record decisions without recording prompts

Introduce versioned, bounded decision receipts containing configured identities, candidate assessments, stable outcome codes, timing and reported/unknown selector usage. Do not persist task state, arbitrary inventory/provider error prose, raw answers or chain-of-thought. Receipts are diagnostics, not authorization or proof of completed inference.

### Keep diagnostics observational

The core exposes an explicit optional observer; imports remain side-effect-free. Records are immutable. Observer failure must not substitute a model or alter the decision result. Native integration persists records as custom entries outside model context; tool content continues returning assignments rather than diagnostic payloads.

### Distinguish selector invocation from network execution

A generic selector interface can prove that its method was invoked, not that an HTTP request reached a provider. Count invocations/outcomes explicitly. A returned usage report can be known even when answer validation later fails. Missing timeout/cancellation usage is unknown, never implicitly zero.

### Separate proposal from execution

Preview uses the existing selection machinery but cannot change active selection, execution guidance, task state or pending work. Explain reads the original receipt; rerunning inference is a separate operation. A future shadow mode must declare its execution baseline and label proposal versus actual execution separately.

### Improve context explicitly

Keep existing per-user-turn routing and latest-user-prefix input as the compatibility defaults. The user-approved S04 refinement adopts opt-in bounded recent dialogue and session affinity with explicit reselection, rather than a separate memory/workflow system. Defer durable briefs, automatic summaries, inferred task boundaries and coordinator fallback. Do not silently send tools, files, images, system prompts or execution-role guidance to the selector. See [ADR 0001](adr/0001-bounded-dialogue-and-affinity.md).

### Capacity admission is not execution control

Use explicit estimates of execution input, never the selector window, and keep unknown limits visible. Strict estimated admission rejects unknown or insufficient capacity; permitted compaction can waive input/context uncertainty but cannot fix an impossible output reserve. Neither mode sets generation limits, owns compaction, nor certifies final provider payloads. Native heuristic counting is an explicit, local pre-transform estimate; see [ADR 0002](adr/0002-capacity-is-admission-not-execution.md).

### Measure before optimizing

Create frozen evaluation cases and offline replay before adding caching or switch suppression. Exact caching, if justified, binds the entire permitted request, policy and selector configuration, revalidates eligibility and never reuses a consumed authority handle. Fuzzy caching and uncalibrated confidence shortcuts are excluded.

## Error Handling Strategy

Preserve existing RoutingError codes and fail-closed choice validation. Add stable diagnostic exclusion/attempt codes without exposing raw error text. Terminal receipts distinguish assignment/preparation, abstention, error and cancellation. Selector timeout is a terminal outcome even if the provider ignores cancellation. Diagnostic delivery is best-effort and cannot replace the original result/error. Unknown costs remain explicit; observation does not implement retries or fallback.

## Risks and Unknowns

- Richer task context improves suitability but increases data sharing; context policy must be opt-in and bounded.
- Short-message keyword heuristics cannot reliably identify task boundaries.
- Capacity estimates are not provider tokenizers, and later extensions may modify context.
- Diagnostic persistence can fail independently of selection; completion records are not a billing ledger.
- The current host baseline is Pi 1.2.0; the original 149-test suite also passed against Pi 1.0.1. This is not a claim of compatibility with every 1.x release. See [compatibility guidance](COMPATIBILITY.md).
- Real semantic quality, savings and virtual-child startup remain unverified.

## Existing Codebase / Prior Art

The policy parser freezes configuration; the core constructs and consumes single-use decisions through an injected inventory. Native adapters enforce physical/input eligibility and branch/task stickiness. Built-in classifier and LLM selectors share a bounded execution boundary. Transcript notices and optional execution guidance are separate from the core. The competitive review supplies version-pinned examples of diagnostics, task briefs, exact caching, context fit and evaluation discipline.

## Relevant Requirements

- R1: Explain candidate exclusions and terminal outcomes without leaking task/provider data.
- R2: Distinguish selector invocations, returned observations and unknown usage.
- R3: Provide non-mutating diagnostic commands with explicit inference behavior.
- R4: Reproduce selection-policy checks offline and separate them from live quality evidence.
- R5: Preserve multi-message task meaning through explicit, bounded context controls.
- R6: Make capacity constraints and compaction consequences visible without hidden escalation.
- R7: Preserve existing policy, privacy, lifecycle and library boundaries.

## Scope

### In Scope

Decision receipts; operator doctor/preview/explain; offline evaluation/replay; opt-in bounded dialogue/session affinity and explicit reselection; capacity diagnostics and constraints; conditional measured optimization; integrated regression coverage and documentation.

### Out of Scope

Live credentialed evaluations without separate approval; global installation or publication; automatic project-config layering; provider fallback/retry execution; automatic budget downgrades; tool-permission configuration; autonomous child creation; edits to pi-gsd.

### Non-Goals

Universal model rankings, guaranteed cost savings, replacing Pi's compaction or provider runtime, and treating role instructions as permissions.

## Technical Constraints

Node.js 24+, TypeScript, Windows-compatible development commands, currently pinned Pi 1.2.0. Preserve optional runtime peers and a core without Pi runtime imports. Keep configuration/state/receipt sizes bounded. No delegation, commits, remotes or credentialed inference is implicitly authorized by this milestone.

## Integration Points

Pi native virtual routes, model registry, custom session entries/renderers, command/tool APIs and transformed execution context. Libraries receive explicit policy/inventory and own any observation sink. Evaluation tooling consumes recorded answers and explicit synthetic cases by default.

## Testing Requirements

Retain the 69-test starting baseline. Add public-behavior tests for receipt privacy, immutability, exclusion taxonomy, post-selection revocation, observer isolation, reported usage on failed answers, timeout/cancellation unknowns, and SDK/tool transcript isolation. Later slices add command non-mutation, offline replay, task lifecycle and capacity-boundary tests. Final verification includes typecheck, tests, JS/declaration build and documentation/package checks.

## Acceptance Criteria

1. Decision records reach native/tool UI on a narrow end-to-end path without changing assignments or injecting diagnostics into context.
2. Operators can check, preview and explain with documented inference and persistence behavior.
3. A versioned offline corpus/replay report can demonstrate constraint behavior and compare recorded selector suitability.
4. Explicit task context controls preserve meaningful follow-ups across their documented lifecycle.
5. Capacity requirements fail explicitly or permit documented consumer/Pi-owned compaction without claiming success, disabling host compaction, or modifying generation limits.
6. Any optimization has measured justification and exact invalidation tests; absence of justification is documented deferral.
7. The assembled extension and library retain all prior guarantees under fresh integrated verification.

## Open Questions

- Detailed command UX and preview cost consent are settled in the diagnostics slice before implementation.
- S04 affinity follows existing branch state across unchanged reload/resume/forks and compaction; reset is an explicit branch entry. Dialogue uses the current projection, not a durable summary. Lifecycle verification is required before completion.
- S05 uses explicit caller estimates or opt-in native Pi heuristics; unknowns remain explicit, and direct requests cannot recursively compact. Provider-exact token counting and final-payload guarantees remain outside this admission contract.
- Cache implementation and switch-cost policy remain contingent on measurements, not committed features.
