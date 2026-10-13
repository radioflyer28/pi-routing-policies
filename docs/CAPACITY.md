# Capacity admission

Capacity checks are **opt-in estimated admission**, not execution controls. They compare an estimate of the intended execution input plus an output reserve with observed model limits. They do not measure S04's selector window, set generation `maxTokens`, change thinking, compact a conversation, or guarantee a provider will accept the final request.

## Modes and unknowns

| Condition | `require-estimated-fit` | `allow-compaction` |
| --- | --- | --- |
| Known input + reserve ≤ known context window, reserve ≤ known output limit | Admit as `estimated_fit` | Admit as `estimated_fit` |
| Input + reserve exceeds window, but reserve alone fits | Reject `capacity_context` | Admit as `context_exceeded`; consumer owns compaction |
| Input estimate or context window unknown; output limit known and sufficient | Reject `capacity_unknown` | Admit as `unknown`; no fit claim |
| Output limit unknown | Reject `capacity_unknown` | Reject `capacity_unknown` |
| Reserve exceeds known output limit | Reject `capacity_output` | Reject `capacity_output` |
| Reserve alone exceeds known context window | Reject `capacity_context` | Reject `capacity_context` |

Equality fits. Declared counts must be nonnegative safe integers up to 1,000,000,000. Inventory limits must be positive counts in that range; missing, zero, negative, non-integer or otherwise invalid metadata is **unknown**, not unlimited capacity. Known impossible output requirements take precedence over unknown input. Normal scope, effort, allowlist, auth and input-support checks still apply.

`allow-compaction` is permission to leave context handling to the consumer. It does not prove that Pi compaction is enabled or can shrink the request enough. Conversely, `require-estimated-fit` does not disable Pi compaction: Pi may compact at its own threshold after admission succeeds. Unknown or failed admission never triggers an automatic upgrade, downgrade or fallback.

## Library callers: declare execution requirements

Existing inventory callbacks continue to work without changes when capacity checks are absent. For capacity-aware calls, return observed physical limits alongside eligibility:

```ts
const router = createRouter(policy, target => ({
  eligible: permitted(target),
  capacity: {
    contextWindow: lookupContextWindow(target),
    maxOutputTokens: lookupOutputLimit(target),
  },
}));

const capacity = {
  mode: "require-estimated-fit" as const,
  inputTokens: 12000,
  outputReserveTokens: 4096,
  estimateSource: "caller" as const,
};
const assignment = await router.resolve("wiki/edit:high", { capacity });
```

The lookup/estimation functions above are consumer-owned. Count the intended worker's execution request, including applicable system instructions, tools, conversation, attachments and later additions—not just its short task description. `inputTokens: null` represents an unavailable estimate. The source enum is `caller`, `pi-heuristic` or `unknown`; `unknown` must accompany null input. Source labels are descriptive, not authenticated provenance or permissions.

The exported pure helper `assessCapacity(requirement, observedLimits)` returns `{ eligible, code?, assessment }` for capacity alone; it does not check authorization, identity, input support, scope or effort. Use the router for complete assignment validation.

The same optional constraint works with `prepare`, `select` and `revalidate`. A prepared decision snapshots the requirements and rechecks current inventory limits after the answer. Capacity-constrained assignments retain their requirement; plain assignments keep their previous shape. Revalidation preserves the original mode/output reserve when new constraints are omitted. A fresh requirement can replace the input estimate and strengthen mode/reserve, but cannot weaken strict mode or lower the original reserve. Use the returned assignment, and refresh the estimate before dispatch when context changes:

```ts
const checked = await router.revalidate(assignment, {
  capacity: { ...capacity, inputTokens: updatedExecutionEstimate },
});
```

The library does not discover session context or verify estimate accuracy. Serialized assignments are not authority; consumers still enforce their own restrictions. An omitted fresh estimate retains an old snapshot—it does **not** automatically count new input.

## Coordinator tool

`virtual_models` accepts the same optional `capacity` object for `resolve`, `select`, `prepare` and `answer`; tool callers use `estimateSource: "caller"`. `answer` retains the prepared requirement even when the argument is omitted. Declaring a child estimate does not inspect the parent's history, change the parent's selection or launch a worker.

```json
{
  "action": "resolve",
  "selection": "wiki/edit:high",
  "capacity": {
    "mode": "require-estimated-fit",
    "inputTokens": 12000,
    "outputReserveTokens": 4096,
    "estimateSource": "caller"
  }
}
```

## Native routing

Merge `capacity` into your existing `nativeRouting` configuration, preserving any context/affinity options, then `/reload`:

```json
{
  "nativeRouting": {
    "capacity": {
      "mode": "require-estimated-fit",
      "outputReserveTokens": 4096,
      "inputEstimate": "pi-heuristic"
    }
  }
}
```

No `capacity` field means the previous behavior. Once capacity is enabled, `inputEstimate` defaults to `unknown`, so strict native admission fails closed unless a supported estimate strategy is explicitly selected. Output reserve is required; there is no automatic budget choice.

`pi-heuristic` uses the pinned Pi host's public `estimateTokens` over the **full current routing request**, including system/tool/history text. It is local, makes no inference call and sends none of that additional text to the selector. It does not reuse historical provider usage or build a new tokenizer. It is a character-based pre-transform estimate, not a target-specific token count; system deltas can overcount, text/token ratios vary, and later hooks/provider serialization can change the payload.

Images produce unknown native input rather than borrowing Pi's fixed image estimate. Normal requests also become unknown when this catalog has role instructions or `routingContext: "assignment"`, because those are added after routing. `allow-compaction` may admit that unknown input only with sufficient known output capacity; the diagnostic stays `unknown`. Callers needing stronger estimates should use explicit library/tool inputs with their own execution context model. User/assistant text can contain secrets; estimates/receipts carry only counts, not raw execution content.

Native routes recompute the estimate for every dispatch, including affinity reuse. If the pinned target no longer meets the requirement, it errors without reselecting. Changing capacity configuration changes the policy revision; existing S04 stale-pin/reselection rules apply.

### Direct calls and compaction

Direct/summary calls cannot recursively compact their own input. With capacity enabled they use **strict admission** against their own request, even when normal routing permits compaction. They never classify the summary or reuse the main conversation's input estimate. This can deliberately reject an oversized or unknown summary request instead of claiming it can compact itself. Existing explicit `direct` target behavior is otherwise unchanged.

Pi owns actual compaction and output/reasoning limits. A reserve is a routing planning requirement, not a promise of that many answer tokens; provider-specific thinking can share or adjust output ceilings. See [ADR 0002](adr/0002-capacity-is-admission-not-execution.md) for the pinned-host source inspection.

## Diagnostics and evidence

Decision receipts carry the effective capacity requirement plus each checked candidate's normalized limits/status. Stable rejection codes distinguish unknown, context and output problems. Expanded notices show bounded count-only details and qualify permitted compaction. Successful explicit direct targets expose the same information in their route notice; failed direct checks appear as the `direct` candidate in a route-failure receipt. Capacity observations are not proof of generation completion.

`/vmodel` shows configured native capacity policy. Doctor reports registry capacity facts and configured policy without inference; it does not certify execution fit. Preview still routes only its supplied diagnostic task, without applying native capacity policy or estimating a worker's execution request. Its report explicitly says capacity was not assessed. Explain shows the original receipt rather than recomputing it.

Tests use fake registry/provider data and offline boundary cases. The frozen S03 corpus stays unchanged; its version-1 schema does not accept capacity constraints. These tests establish admission/lifecycle mechanics, not live token accuracy, successful compaction across every provider, model quality or savings.
