# M001 S01 — Explainable decision records

**Completed:** 2026-10-04  
**Scope:** historical completion snapshot for the first slice of the [roadmap](M001-ROADMAP.md), not a current feature inventory or completion of the full milestone. Consult the roadmap for later slices.

## Delivered

- Optional `createRouter(config, inventory, { onReceipt })` observation with one immutable terminal record per public call and independent concurrent captures.
- Stable namespace, effort, allowlist and inventory exclusion codes. Post-selector revocation is recorded as the latest eligibility check.
- Separate receipt and authority-decision IDs; receipt data cannot authorize or dispatch an assignment.
- Selector method invocation/outcome/timing and explicitly nullable reported token/cost values. Known usage survives completed-but-invalid classifier/LLM answers. Unknown charges remain unknown.
- Best-effort observation: observer throws/rejections do not replace results/errors or trigger fallback.
- Native/tool custom-entry persistence outside execution context, expanded success details, and distinct expandable failure notices without duplicate compact successes.
- Native pre-core and post-resolution errors recorded separately; post-resolution failures correlate to the logical assignment and measure elapsed time from route entry.
- `/vmodel` and `/virtual-model` status gain `selectorAttempts` alongside legacy reported usage, with explicit unknown counts and double-counting warnings.

## Evidence

Fresh `npm run verify` after the final implementation change exited 0:

- **84 tests passed; 0 failed**: all 69 starting tests plus 15 new regression tests.
- TypeScript typecheck and JavaScript/declaration build passed.
- Built exports and the side-effect-free core dependency graph passed.
- Example/documentation JSON and local documentation links passed.
- Package-content checks passed.

New cases cover exclusion/privacy contracts, immutable records, known zero versus unknown usage, rejected answers, target revocation, timeout/abort/unavailability, observer isolation, concurrent attribution, the maximum 192-variant catalog, SDK/tool context isolation, failure rendering, status accounting, direct-call failures and post-resolution dispatch failure correlation/timing. The maximum-catalog record is below 64 KiB.

## Boundaries preserved

No new selector calls, model fallback, effort downgrade, task-boundary behavior, permissions or orchestration were added. The existing assignment/decision return shapes remain unchanged. Tool content still contains the assignment, not its diagnostics. Configuration discovery and native registration remain opt-in; the core gains no runtime Pi dependency or ambient I/O.

## Targeted privacy/authority review

The inspected new path is selector/inventory data → core capture → explicit observer → custom entry/renderer. No blocking exploit was identified in this bounded review; this is not a full-package security certification.

Non-findings considered: receipts cannot be consumed as prepared authority handles; policy/scope and live eligibility checks remain authoritative; raw task state, criteria, answers and free-form errors do not enter capture; usage crosses the boundary only as finite nonnegative numbers or unknown values; renderer text strips terminal controls; catalog bounds and the maximum-catalog test constrain record size. Observer failures cannot replace the routing result.

Trust limits: configured role/model identities are visible, session files are not tamper-evident, and application-supplied observers/other extensions still have ordinary process privileges. Observer isolation is error isolation, not a sandbox. No code was changed during this targeted review.

## Limitations and handoff

- These are terminal diagnostic records, not an in-flight journal or authoritative billing ledger. Process crashes can lose records; method invocation does not prove an HTTP request.
- A logical assignment is not proof of dispatch, inference completion or task success. Requested physical thinking in a core receipt remains distinct from Pi-clamped effective thinking in the native notice.
- Free-form inventory/error prose, task state, criteria and raw provider answers are deliberately absent. Receipts expose configured role/model identities and performed checks only.
- Invalid configuration before router construction and tool argument validation before a core operation are outside the core receipt boundary.
- `doctor`, `preview` and `explain` are **not implemented**. S02 must preserve proposal/execution separation, disclose preview inference cost, and explain the original receipt without rerunning selection.
- Evaluation, explicit task briefs/boundaries, capacity constraints and conditional optimization remain pending.
- No live provider evaluation, global install, publication, commit, delegation or pi-gsd runtime change was performed.
