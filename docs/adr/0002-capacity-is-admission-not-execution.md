# Capacity is opt-in admission, not execution-budget control

Status: accepted for S05 implementation.

Capacity must assess execution input, not S04's small selector window. Add explicit caller capacity constraints and inventory limit observations; do not change generation limits, thinking, host compaction settings or hard selection constraints. A passing estimate is not a provider guarantee, and permitting Pi-managed compaction is not proof that it is enabled, possible or successful.

## Pinned-host evidence

Inspected installed `@earendil-works/pi-coding-agent` and `pi-ai` **1.0.1**, not an assumed future host API:

- `agent-session.js`, `_installAgentRequestProjection`: the native route receives the current request before the selected physical model's compaction check. Pi keeps the route after compaction, rebuilds context and later runs request-context hooks. `ModelRoute` has model/thinking/state, not a generation token-cap control.
- `agent-session.js`, `getContextUsage` / `_limitsModel`: usage is associated with the latest routed/selected model and can be null after compaction. It is not an exact count of a future request for every candidate.
- `compaction/compaction.js`: `estimateTokens` is a public character-based heuristic, including system/tool text and a fixed image estimate. Internal projected estimates can combine historical usage and trailing estimates. Public package exports include `estimateTokens`, not the complete internal projection estimator.
- `pi-ai` `types.d.ts`: physical models expose `contextWindow` and `maxTokens`. Zero/unusable metadata is not evidence of unlimited capacity.
- `pi-ai` `api/simple-options.js` and `api/anthropic-messages.js`: execution adapters clamp output against context and can adjust shared reasoning/output budgets. The router cannot promise that a declared output reserve becomes answer tokens. Other adapters use different output parameter names/compatibility controls.

## Admission contract

- No capacity constraint means unchanged admission and no new capacity checks.
- A capacity requirement contains mode (`require-estimated-fit` or `allow-compaction`), declared input tokens (number or null), output reserve tokens and a bounded source enum. Counts are nonnegative safe integers no greater than one billion; observed model limits must be positive counts, otherwise unknown. No arbitrary source prose enters receipts.
- Strict mode requires known limits and input estimate, input plus output reserve within the context window, and output reserve within the model output limit. Equality fits. Unknown requirements/limits are not zero.
- Compaction-permitted mode can admit excess/unknown input or an unknown context window, explicitly labeled as exceeded/unknown. It still rejects an unknown/insufficient output limit or an output reserve that alone exceeds a known context window: compaction cannot repair those requirements. This mode delegates context handling to the consumer; the library itself never compacts.
- Scope, effort, allowlist, auth, physical type and input support remain mandatory. Filter before selection and recheck current limit metadata after acceptance and on every affinity reuse. A revoked/undersized pin errors, not silently reselects.
- Capacity requirements are snapshotted into prepared decisions and retained with capacity-constrained assignments. Revalidation cannot drop the original requirement or silently weaken its mode/output reserve; it can supply a fresh input estimate and stricter requirements. Estimates are descriptive, not authority. The caller must refresh estimates as execution input changes.
- Receipts expose numeric limits, source, requirements and stable capacity statuses/exclusions without raw execution/selector text. Default unconstrained receipts/assignments retain their old shape.

## Native policy

`nativeRouting.capacity` enables a mode, output reserve and `inputEstimate` (`unknown` by default, or explicit `pi-heuristic`). The heuristic uses Pi's public `estimateTokens` over the full routing request (including system/tool/history text), never the clipped selector state, and does not reuse historical provider usage. Images and this extension's later role-guidance/assignment-context additions make native input unknown rather than inventing their final token cost. Other extensions/provider transformations remain an acknowledged later-mutation limitation even for text estimates.

Normal native routes recompute the estimate per request, including affinity reuse. Direct/compaction requests cannot recursively compact themselves, so opted-in direct admission uses strict mode against their own request; it never classifies the summary or borrows the main conversation estimate. No capacity config means existing direct behavior.

Tool/library callers supply their own explicit execution estimate. Preview/doctor do not infer capacity from their small diagnostic task: they report configured policy/registry facts, not execution fit. A successful diagnostic preview is not a capacity certification.

## Consequences

`require-estimated-fit` is an admission predicate, not a command disabling Pi compaction; Pi can compact at its own threshold even after estimated admission succeeds. Unknown-by-default native estimates intentionally block strict native admission until an explicit supported estimate strategy is selected. Permitted compaction may fail or be disabled. Callers needing provider-exact counts, final-payload guarantees or enforced no-compaction execution need a separate provider/host execution contract. No homemade tokenizer, implicit upgrade/downgrade, fallback, generation-budget mutation or live evaluation is introduced.
