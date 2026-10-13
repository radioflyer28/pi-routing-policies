# Implementation notes

This describes the local implementation, not a published package or measured routing quality. See [README](../README.md) for configuration and [DESIGN](DESIGN.md) for the architectural contract and original research.

## Modules and boundaries

| Module | Responsibility |
| --- | --- |
| `src/core/types.ts` | Policy, assignment, selector and error contracts |
| `src/core/policy.ts` | Strict immutable JSON policy parsing, selector validation, canonical revisions and selection grammar |
| `src/core/index.ts` | Prepare, accept, select, resolve and revalidate; no runtime Pi imports |
| `src/core/capacity.ts` | Validated capacity requirements, normalized limit observations and pure admission assessment |
| `src/core/receipt.ts` | Per-operation immutable decision capture, stable exclusions and numeric-only selector observations |
| `src/selector-call.ts` | Common timeout/abort boundary, including uncooperative providers |
| `src/classifier.ts` | Native `findOfType("classifier")` / `classify` adapter |
| `src/llm.ts` | One native physical chat call, reasoning clamping, bounded strict JSON output |
| `src/selectors.ts` | Explicit backend factory; no fallback |
| `src/pi-adapter.ts` | Native registrations, eligibility, branch/task stickiness, opt-in affinity and dispatch notices |
| `src/native-capacity.ts` | Opt-in full-request Pi heuristic or explicit unknown; no generation controls |
| `src/native-context.ts` | Projected dialogue admission, explicit text budgets, UTF-8 state fitting and count-only context summaries |
| `src/execution-context.ts` | Request-local role guidance and opt-in assignment metadata |
| `src/routing-notice.ts` | Bounded diagnostics and native expandable transcript/tool rendering |
| `src/decision-notice.ts` | UI-only failure records, expanded exclusion details and invocation accounting |
| `src/diagnostics.ts` | Command grammar, no-inference doctor/explain, consent-gated preview and UI-only reports |
| `src/evaluation.ts` | Pure bounded artifact validation, independent fixture oracle and deterministic offline replay |
| `scripts/evaluate.mjs` | Explicit bounded file input/output, CLI split selection and implementation provenance |
| `src/advisor.ts` | Local public inventory, namespace-only proposals and command-only application |
| `src/advisor-store.ts` | Bounded policy reads, cooperative lock, stale-byte checks, backups and atomic file replacement |
| `skills/routing-policy-advisor/` | Grilling/domain-modeling interview adaptation and schema reference |
| `src/extension.ts` | Opt-in config loading, registration, commands and coordinator tools |

The root/core library exports are independent of Pi runtime packages. Classifier and LLM factories do not discover config or register anything. Creating the native extension is the only path that registers aliases, context hooks, tools or renderers. No process-global extension singleton is assumed.

## Configuration and identities

The version-1 policy permits 1–64 roles. Every configured variant and `__abstain__` has exactly one choice criterion. Extra keys, malformed defaults/targets, non-JSON values and recursion through this catalog's native aliases are rejected. Policy files are capped at 256 KiB; consumer task state at 16 KiB. The parser snapshots/freezes input and hashes its canonical content. Selector, scope, guidance and native context/affinity changes invalidate prior assignments.

Virtual namespace/role components use lower-case ASCII letters, digits and hyphens, begin with a letter, and are at most 48 characters. `auto` is reserved. Physical IDs are separate strings and preserve slashes/colons.

- `autoModel` configures the global automatic identity, defaults to `virt/auto`, and accepts `false` to disable it.
- `namespaces` explicitly enables scoped `namespace/auto` identities. Each must have configured roles and cannot collide with the global identity.
- A global identity's spelling does not filter candidates. A scoped identity filters by exact namespace prefix, then intersects effort, caller choices and physical eligibility.
- Namespace selector overrides are complete configurations. An absent override inherits the root selector; an absent selector allows explicit/coordinator resolution but automatic calls fail clearly.
- `policy.automatic` exposes resolved scope/selector configuration for each entry. `policy.autoModel` is undefined with global routing disabled. `parseSelection(value, Object.keys(policy.automatic))` handles multiple entries; passing a single global identity remains supported.

Command/library spelling is `namespace/role:effort`; native spelling is `namespace/role/effort`. Bare auto and explicit medium are distinct registrations. Virtual entries advertise only `thinkingLevels: ["off"]`; their identity conveys virtual effort and the resolver supplies physical thinking. Pi clamps the physical level.

`/vmodel` and `/virtual-model` share one command handler, including status and missing-config help. Selection changes do not infer or invoke a routing call.

## Policy construction (M001 S06)

The bundled advisor skill performs an iterative, user-confirmed design conversation. `virtual_models_advisor` only inspects local allowlisted registry metadata or constructs a bounded in-memory namespace proposal; it does not invoke selectors or mutate policy. `/vmodel advisor apply <id>` is command-only, rechecks identity/eligibility and stale bytes, creates a backup, and atomically replaces the configured file. No reload/selection or permissions are implied. Missing-default onboarding uses the same support; missing explicit files still fail closed. Root settings and unrelated namespaces are preserved. See [advisor behavior and trust limits](ADVISOR.md).

## Selector execution

Both built-in backends receive the same filtered `{ state, questions: { route } }` request. They never receive configured execution-role instructions as part of that contract. LLMs are not asked to fabricate confidence; native classifier confidence/probabilities are optional diagnostics only.

- **Classifier:** native Pi registry discovery/execution, with a 10-second default timeout. No `pi-typesafe` extension dependency.
- **LLM:** native Pi physical text/chat lookup, configured-auth check and `streamSimple`. Selector thinking is configured independently and capability-clamped. No tools, transcript or ambient system prompt are supplied. The dedicated system instruction requires a single JSON answer and treats task state as untrusted data. Default timeout is 30 seconds and output budget 2048 tokens; allowed budgets are 128–8192. Output is limited to 64 KiB, including emitted thinking; reasoning content is discarded, not logged.
- Timeout range for both is 1–120000 ms. Both forward AbortSignal and stop waiting even if a provider ignores it. Late results cannot become assignments. Provider failures are sanitized rather than persisting raw error payloads.
- No fallback provider, model substitution, implicit escalation or retry loop is implemented. Existing coordinator calls can use `prepare`/`accept` instead of either backend.

Choices are checked against offered candidates, then physical eligibility is checked again. Exact prepared handles are single-use and router-instance-bound through a WeakMap. Assignments are data, not authorization; `revalidate` reconstructs targets and guidance from the current policy rather than trusting serialized instructions.

## Decision records (M001 S01)

`createRouter(config, inventory, { onReceipt })` optionally observes each public operation through a fresh per-operation capture. Public calls deliver exactly one terminal `DecisionReceipt`; the private prepare/accept phases inside `select` do not independently emit. Concurrent operations cannot overwrite each other's capture. Assignment and decision return shapes remain unchanged.

Receipts contain version 1, a unique receipt ID, policy revision, recognized selection (otherwise `null`), operation, start/elapsed time, outcome, safe error code, correlation decision ID when available, candidate assessments, optional resolved target, and selector invocation/usage data. They contain no request state, question/role instructions, raw answers or error prose. Catalog bounds limit assessments to 192 entries; the maximum-catalog regression checks a serialized receipt stays below 64 KiB. The observer receives a recursively frozen object; observer exceptions and promise rejections are isolated and are never a routing fallback.

Candidate assessments identify scope (`namespace`), effort (`effort`), allowlist (`not_allowed`) or a stable inventory code. The native inventory distinguishes missing chat target, native virtual target, missing configured auth and unsupported inputs. Consumer inventory can supply `restricted`; arbitrary/unknown codes fall back to `inventory_rejected`. Capacity-aware checks additionally record normalized numeric limits/statuses and the effective requirement, without execution text. Free-form `Eligibility.reason` is not persisted. Each choice has its latest performed check, including revalidation after a selector returns. Early failure may leave a partial or empty assessment list.

Terminal outcomes are `prepared`, `assigned`, `abstained`, `aborted` and `error`. `errorCode` preserves known RoutingError codes and maps unexpected errors to diagnostic `INTERNAL_ERROR` without copying their message or changing the original thrown error. Invalid configuration before construction is outside this observation boundary.

`selector.invoked` means the selector method was called, **not** that a provider received an HTTP request. Its outcomes distinguish `not_invoked`, `returned`, `unavailable`, `timeout`, `aborted` and `error`. A returned result may subsequently fail offered-choice validation or eligibility rechecks. Built-in adapters preserve numeric usage observations on completed-but-invalid responses through `RoutingError.selectorObservation`. Interrupted streams without a usage report remain unknown. Receipt `totalTokens` and `cost` are explicitly `null` when unknown; reported zero is retained.

Native and tool observers append `virtual-models.decision-receipt` entries with source `native` or `tool`. Successful entries have no independent renderer output; existing native/tool notices include the receipt in expanded UI details. Failed entries have a compact expandable renderer. Native pre-core failures (empty task/missing direct assignment) and post-resolution dispatch errors receive a separate `route` operation record; a core failure is not emitted twice. Core `assigned` means a logical assignment, not proof that dispatch or inference completed. Its target thinking is policy-requested thinking; the normal native notice continues showing effective Pi-clamped thinking.

Receipt delivery is best-effort, and no start-event journal is maintained. An in-flight operation or process crash may have no terminal record. Custom library selectors remain responsible for their own timeout/cancellation contract; bounded behavior is guaranteed by the built-in adapters. This is diagnostic accounting, not a provider billing ledger.

## Native lifecycle

By default each new user turn selects again in automatic mode. State stores the assignment, selection epoch and latest user-entry task ID. Continuations/retries reuse only matching state on the active branch. `nativeRouting.affinity: "session"` allows matching automatic state to survive new user turns, still revalidating every dispatch. Explicit selections bypass selectors regardless of affinity. A failed fresh selection must never revive an unrelated old pin.

`/vmodel reselect` and `/virtual-model reselect` require a current automatic selection and idle execution, then append `virtual-models.reselect` without inference or model/thinking mutation. This entry joins manual model changes and `virtual-models.selection` in the epoch calculation. It invalidates assignments, not dialogue. The next normal request selects again; direct requests still cannot classify. No new tool authority is exposed. Status reports effective native context options, affinity and the branch's current choice without inference.

The default native selector state remains latest-user prefix (3000 UTF-16 code units), truncation flag and image-presence metadata. `nativeRouting.context` explicitly enables a bounded prior-message window (default three user messages, 8000 history characters, 3000 per-message characters, head-tail clipping). `includeAssistant` defaults false; true admits assistant text as data. Zero history/window disables prior text. `prefix` and `error` are explicit alternatives. Current text takes priority, recent nonempty dialogue is allocated newest-first and rendered chronologically, and binary fitting enforces the 16 KiB serialized-state cap under UTF-8/JSON escaping. Visible truncation includes per-excerpt flags, an aggregate omission flag, and count-only expanded routing notices. No raw state enters notices/receipts.

Pi converts custom/bash/summary entries into user-role messages before routing. The adapter therefore cross-checks user/assistant role, timestamp and text against the current session projection before admission. It never retrieves compacted-away text from raw branch history. Only text blocks qualify: no tools, arguments, thinking, images, system/custom messages or synthetic summaries. User-pasted or assistant-echoed text is not redacted. Input support is separately enforced for execution targets; a text-only selector cannot infer image semantics. Library/tool/preview inputs remain independently supplied and are not enriched from the native window.

Affinity survives unchanged reload/resume and compaction. Forks/tree navigation inherit ancestral state, with subsequent resets branch-local; new sessions have no pin. Capture session ID, branch anchor, selection epoch and latest user-entry ID before asynchronous routing, suppress records/accounting on a changed context and reject late dispatch. Discarded calls can still incur unrecorded charges. See [ADR 0001](adr/0001-bounded-dialogue-and-affinity.md) for the privacy boundary and rejected memory/workflow alternatives.

Direct/compaction requests do not classify summary prompts. They recover the matching branch assignment or use an explicitly configured physical `direct` target. Otherwise automatic direct routing fails `NO_ASSIGNMENT`. An explicit selection always resolves deterministically. All reused targets are revalidated.

On reload shutdown, unregister this factory's exact provider/IDs after checking their expected virtual API/name, preserving unrelated registrations. Pi otherwise retains virtual registrations. Removed/renamed selections are not migrated. Changed policies reject stale state; default turn routing can select again on a new user turn, while session affinity requires explicit reselection or selection change. Native Pi may restore the last physical responder if a previously selected alias no longer exists.

SDK startup tests use `createAgentSessionServices()` then `createAgentSessionFromServices()` so factory registrations precede initial model selection. Lower-level session construction alone may leave a startup placeholder.

## Capacity admission

Optional `Constraints.capacity` carries a declared execution-input estimate, output reserve, bounded source enum and `require-estimated-fit` / `allow-compaction` mode. Inventory's optional `capacity` observations report context/output limits. The core checks only after ordinary eligibility, filters before selector invocation and rechecks during acceptance/revalidation. Unknown/invalid limits normalize to null; no raw inventory prose is copied. Output failures and impossible reserves always exclude; compaction mode only waives context overflow/unknown input or window. Candidate receipt codes are `capacity_unknown`, `capacity_context` and `capacity_output`.

Prepared handles snapshot requirements alongside choices and assessments. Constrained assignments retain the requirement; revalidation merges a fresh input estimate while keeping at least the original mode/output reserve. This is not a cryptographic authority contract: callers own restrictions and estimate freshness. Unconstrained assignments/receipts preserve their old shape.

Native `nativeRouting.capacity` recomputes input per dispatch, including affinity reuse. Explicit `pi-heuristic` uses the public pinned-host `estimateTokens` on all routing messages, including system/tool text, without historical usage reuse or extra selector egress. Default input, images and later own guidance/context additions are unknown. Direct calls force strict mode on their own request; direct fallback-target failures use a bounded `direct` assessment in the route receipt, while successful direct notices expose the assessment without inventing a role assignment. Updated capacity snapshots cause new native state only when counts/requirements change.

Status/doctor expose policy/registry facts. Preview does not derive execution capacity from its small task, and says so. Capacity-aware tools still use caller-supplied child estimates; native policy is not silently applied to independent tools. Expanded diagnostics show counts/statuses only. See [capacity guide](CAPACITY.md) and [ADR 0002](adr/0002-capacity-is-admission-not-execution.md) for exact semantics and source evidence.

Routing happens before host compaction and context transforms. `require-estimated-fit` does not disable host compaction or guarantee final payload fit; allowing compaction cannot guarantee success. The declared reserve does not set stream options or promise answer tokens under provider-specific reasoning ceilings. Default routing remains unchanged.

## Context and role guidance

`models[role].instructions` is optional, nonempty soft guidance, limited to 4096 characters and rejecting terminal controls. It applies to every effort in that role. No tool-permission fields exist.

Core assignments return the guidance; library consumers decide whether/how to apply it. The native extension's `context` hook runs after native route preparation. It reads only the selected virtual model's current branch/task state, revalidates it, and appends one hidden custom message to that request's transformed context. It does **not** append a session message. The next request reconstructs the note from current assignment state, excluding older copies of this extension's note.

By default that note contains only configured role guidance, if any. `routingContext: "assignment"` additionally includes the current selection, choice and physical target; `off` (default) omits routing metadata. Selector identity, prompts, probabilities, reasoning, costs and decision IDs are not included. Physical-model selections and roles without instructions do not inherit old guidance.

The hook affects agent execution requests, not the dedicated selector's registry call or separate direct/compaction calls. Resolving a tool assignment does not overwrite native session routing state or apply child guidance to the parent. Prompt guidance neither grants tool access nor enforces a prohibition; Pi and consumers own actual tool permissions.

## Transcript UI and accounting

Native decisions call `appendEntry("virtual-models.route", ...)`; an entry renderer creates a single-line requested-route → physical-target summary. Ctrl-O uses Pi's standard expansion behavior and configurable `app.tools.expand` key hint. Expanded details show variant, source, requested/effective execution thinking, sanitized selector identity/thinking/usage, guidance and provenance IDs. The notice is a routing decision, not proof of completed inference.

Sticky continuations/retries do not duplicate the original notice. Fresh user routing, fresh non-sticky decisions and direct interactions do. Notices are durable branch data but never model context. The existing native routed-model footer is unchanged.

Router-tool assignments use the same visual renderer in their tool-result details, rather than appending a duplicate notice. They are labeled **Assignment** and explicitly distinguish resolution from dispatch. The tool's content exposes the usable assignment (including role guidance), not selector diagnostics. Prepare/list results remain expandable data.

Selector accounting uses bounded `virtual-models.selector-usage` entries. Only configured identity, known status and finite numeric fields are persisted—no prompt/error/provider payloads. `/vmodel` totals reported data on the active branch. Native selector calls stay separate from Pi execution totals; successful automatic tool selections report their native `Usage` through the public tool-result field as well. Those values must not be counted twice. Missing usage and charges from work continuing after timeout remain unknown.

`/vmodel` also exposes `selectorAttempts`, derived only from active-branch decision receipts. It reports invocations, returned results, timeouts, cancellations, decisions without an assignment (including abstention), known-token/cost subtotals and unknown-usage invocation counts. These categories can overlap: a selector may return a response that is rejected. They overlap existing usage/tool totals and must not be added to them. Older branch records can lack receipts; in-flight/crashed calls are not included. Revalidation and coordinator answers do not increment selector invocation totals.

## Diagnostic commands (M001 S02)

Both command aliases dispatch `doctor [selection]`, `explain [latest|receipt-id]` and `preview [--allow-inference] selection -- task` before interpreting an argument as a model selection. Unsupported syntax fails before inference. Preview requires an explicit selection and 1–3000 characters of text; it does not silently truncate or fetch history. Automatic preview requires the literal consent flag in both interactive and headless modes. Explicit-role preview never invokes a selector.

Doctor inspects the already parsed policy, registration identity/type/name, native text-input inventory, resolved selector configuration and configured provider-auth presence. It does not refresh the registry, resolve credentials, probe endpoints or write config. An optional selection uses an isolated core prepare/resolve operation to explain filtering, discarding its handle and observation rather than creating a coordinator decision. Unconfigured selectors and missing/ineligible targets are diagnostic data, not fallback requests. Missing/invalid configuration retains the existing startup behavior; doctor does not repair it. Registration identity checks cannot certify duplicate ownership by another identical installation.

Preview creates a fresh router and captures its terminal receipt locally. It does not call the native route callback, set model/thinking, update virtual state, apply instructions or touch the coordinator pending map. Only the text task and ordinary policy question reach the selector. The receipt is persisted with source `preview`; no legacy selector-usage entry is emitted. Status reports `previewSelectorAttempts` separately from native/tool `selectorAttempts`. Both are reported/unknown invocation accounting, not billing proof. One preview may run per extension instance; shutdown/reload aborts it. An abandoned branch/session suppresses late persistence rather than misattributing a proposal. Lost reports can still correspond to charged work.

Explain searches active-branch receipt entries by exact receipt ID, or selects the last receipt. It does not search abandoned branches, consume authority handles, revalidate targets or rerun inference. The report reproduces the stored receipt and indicates whether its policy revision differs from the currently loaded revision. Explain itself creates no additional receipt or invocation count.

All three persist `virtual-models.diagnostic` custom entries, never custom messages. The host emits `entry_appended` for SDK/JSON/RPC clients; text print mode requires inspecting the saved session instead. TUI entries have compact/expanded rendering; report payloads are capped at 512 KiB and expanded text at 32768 characters with an explicit truncation notice. Preview receipt entries suppress their independent renderer, including failures, so only the diagnostic report renders. No new diagnostic content enters execution context or changes the native task/epoch calculation. Headless status/selection/setup output also moves from the old model-facing `virtual-models.status` messages to diagnostic custom entries with kind `status`. This intentionally changes the SDK transport, not command payloads. Historical custom messages are not migrated.

Registry-driven config scaffolding is deferred. This slice performs no file creation or automatic policy generation.

## Tools and authority

`virtual_models` supports `list`, `resolve`, `select`, `prepare`, `answer`. Automatic `select` uses the chosen entry's configured backend directly, including scope/inheritance, and returns an assignment without launching work. Explicit selections bypass the backend. Coordinator `prepare`/`answer` needs no dedicated selector.

Pending decisions are limited to 32, expire after five minutes, are branch/session-bound and single-use, and are discarded on reload. Tool-supplied candidate/input restrictions are model input, not trusted authorization. Pi's scoped-model list is a selection control, not a physical-model authorization policy. Consumers must enforce their own inventory restrictions, workflow rules, guidance application and delegation boundaries.

## Offline evaluation (M001 S03)

Maintainer tooling, not a native command or root/core package API, replays a separate versioned corpus and answer set through fresh core routers. The only selector is an in-memory recording reader. The fixture oracle independently derives candidate constraints, explicit/default targets, invocation expectations and rejection codes; it does not derive expectations from receipts. Request projection, question criteria/instructions and final target identity are checked as well.

Initial and post-answer inventory states are explicit fixture data. No provider, filesystem or Pi imports enter the pure evaluator. The CLI reads only explicit/default evaluation artifacts and its own implementation sources for provenance; no session/config/credential discovery occurs. Every case has exactly one recording, even in split runs. Corpus and policy mismatches fail validation before scoring.

Reports omit task text, raw responses, authority IDs and runtime receipt timing, preserving deterministic comparisons. Scoring distinguishes mechanically correct rejection from unsuitable proposals. Explicit/no-candidate cases and recorded selector failures are excluded from suitability denominators with visible unscored counts. Malformed or forbidden returned proposals count as misses; initially appropriate revoked proposals are still scored as proposals, not completed assignments.

The shipped corpus/answers are frozen synthetic fixtures with public 20/20 tuning/holdout splits. They prove replay mechanics and grading arithmetic, not live model quality. The CLI defaults to holdout; a public holdout is not a blind benchmark. No live runner or recorder is implemented. See [evaluation contracts](EVALUATION.md) for schemas, bounds, provenance and the separate live-approval gate.

## Host interoperability

The development Pi packages are pinned to 1.2.0. `tests/compatibility.test.ts` covers extension-triggered custom runs, busy startup/abort/settlement, other extensions' setup messages and prompt sections through tool continuations, selector privacy, changing catalog identities/limits and thinking-free compaction summaries. `tests/sdk-fixture.ts` allows an explicit companion extension setup hook; fixtures still disable model network access and use fake providers.

The native virtual-model and registry contracts used here did not require a runtime migration from 1.0.1. Guidance remains in the request-local `context` hook, not `before_agent_start`. Catalog updates are observed through fresh inventory checks rather than a package-owned refresh/cache. Host-supplied packages remain optional wildcard peers, as Pi's package contract recommends; pinned dev dependencies define the reproducible test baseline, not those wildcard peers. See [compatibility guidance](COMPATIBILITY.md) for operator migration steps, simulated versus live coverage, and remaining acceptance scope.

## Verification and limitations

`npm run verify` typechecks, runs Node tests, builds JavaScript/declarations, and checks package/example/documentation consistency. Tests exercise core bounds and constraints, both fake selector backends, cancellation/errors, selector switching, scope inheritance, manual overrides, isolated native SDK/CLI startup, physical dispatch, sticky turns/session affinity, explicit reselection, reload, resume/forks, direct/compaction, input eligibility, role guidance, bounded dialogue and UTF-8 state budgets, non-accumulating context and narrow-width/expanded native renderer output.

No live inference, live routing-quality evaluation, global installation, publication or virtual child-launch acceptance test is included. S03 includes only offline scoring of explicit supplied answers. No Pi/pi-subagents/pi-gsd runtime changes are needed. Until child startup, isolated profiles and physical authorization are independently verified, resolve physical assignments in the parent.

The decision-record slice adds tests for stable filter/inventory reasons, rejected answers and revoked targets, observation isolation, concurrent attribution, maximum-catalog bounds, native/tool context separation, direct pre-core errors, failure rendering and known/unknown usage accounting. See [M001 roadmap](M001-ROADMAP.md) for the milestone status and remaining slices. S01 changed no routing policy. S02 adds the command-only diagnostics described above, with tests for cost consent, inference-free checks, headless events, branch/reload/cancellation behavior, narrow-width rendering, usage separation and preservation of active routing/coordinator state.

The public source repository uses Apache 2.0. Before npm publication, decide the package name/scope, review public API stability and supported Pi versions, and explicitly authorize any credentialed evaluation. The manifest remains `private: true` to prevent accidental npm publication, with optional runtime Pi peers so core-only consumers need not install another Pi runtime.
