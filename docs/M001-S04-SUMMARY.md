# S04 completion — bounded dialogue and optional session affinity

S04 implements the user-approved narrower scope recorded in [ADR 0001](adr/0001-bounded-dialogue-and-affinity.md), replacing the earlier brief-centric plan. It borrows bounded-context and affinity patterns, not LiteLLM's fallback behavior or an assertion of production-proven multi-turn quality.

## Delivered

- Strict immutable `nativeRouting` policy options. Existing policies keep turn-based routing and latest-user-prefix input; options enter policy revision identity without modifying old policy hashes.
- Opt-in bounded recent user/assistant text with separate current-task priority, a configurable history window/budget, per-message cap and head-tail/prefix/error truncation. UTF-16 character caps and exact serialized UTF-8 JSON bounds are both enforced. Assistant text requires explicit inclusion.
- Admission cross-checks the active request against Pi's current session projection, excluding custom/bash/summary messages that Pi otherwise converts to user-role messages. Tool results/arguments, thinking, images, system/custom messages and execution guidance are not admitted. Compacted-away dialogue is not recovered from raw branch history.
- Optional session affinity through existing branch-persisted assignment state. Every reused target is revalidated. No inferred task boundaries, silent fallback, cache TTL, automatic escalation or model-owned context expansion.
- `/vmodel reselect` and `/virtual-model reselect` reset only a current automatic assignment. No selector call or model/thinking mutation occurs until the next normal request. Recent dialogue and configured privacy limits are unchanged. Explicit and physical selections are not overridden.
- Status shows effective context/affinity settings and current choice. Expanded routing notices expose count-only context/truncation summaries. No raw task/dialogue is added to notices or receipts.
- In-flight results are rejected after session/branch/selection changes, with records and legacy usage suppressed rather than misattributed. Such discarded calls may still incur unknown/unrecorded charges.
- Library/tool/preview input remains explicitly supplied and independent of native affinity/context. Direct/compaction requests never classify their summary prompt.

## Lifecycle

| Event | Behavior |
| --- | --- |
| New user turn, default mode | Select again; continuations/retries reuse that turn's valid assignment. |
| New user turn, session affinity | Revalidate and reuse the assignment; no selector invocation. |
| Explicit reselection/manual selection change | Invalidate prior assignment by branch epoch; next normal automatic request selects again. |
| Unsupported inputs/revoked target | Fail closed; never substitute or reclassify implicitly. |
| Changed policy with an existing affinity pin | Reject stale assignment until explicit reselection/selection change. |
| Unchanged reload/resume/compaction | Preserve valid assignment. |
| Fork/tree navigation | Inherit ancestral state only; later branch-local resets do not affect siblings. |
| New session | No assignment. |

## Verification evidence

`npm run verify` passed after the final code/test changes: **128 tests, 0 failures**, including the existing 108 and 20 new tests (7 context contracts, 13 native integration cases). Typecheck, JavaScript/declaration build, public export/core dependency checks, JSON documentation examples, recursive local Markdown links (including ADRs), package checks and all **40 compiled offline replay cases** passed.

Coverage includes both fake selector backends, short approvals referring to assistant prose, default user-only behavior, bounded history chronology, long critical suffixes, Unicode/escaping-heavy payloads, strict rejection, synthetic-message exclusion, nonaccumulating role guidance, manual overrides, reselection/status without inference, unsupported images/revocation, policy changes, reload/resume/forks/compaction, tool/preview isolation, failed-reselection retry safety, late-result isolation and narrow-width rendering.

The focused boundary review checked input provenance, JSON/character bounds, choice/scope/effort revalidation, non-context diagnostics and no new coordinator authority. This is not an independent security audit or live provider evaluation. User/assistant prose can contain secrets or repeat tool data; opt-in admission is not redaction. Bounded windows and head-tail excerpts can still omit important requirements. The frozen S03 corpus/answers were not changed; conversational fixtures prove construction/lifecycle mechanics, not semantic routing quality or savings.

## Deferred and unchanged

Durable briefs, automatic summaries, inferred task lifecycle and abstention-to-coordinator handoff are deferred. Abstention still fails closed. No new dependencies, global installation, live credentialed inference, delegation, commits, publication or pi-gsd changes were made. S05 capacity admission remains the next pending slice and is not implemented here.

See [README configuration](../README.md#native-dialogue-context-and-affinity-opt-in), [implementation notes](IMPLEMENTATION.md), and the [roadmap](M001-ROADMAP.md).
