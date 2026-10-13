# M001 S02 — Doctor, preview and explain

**Status:** complete. This is a historical completion snapshot for the second slice of the [roadmap](M001-ROADMAP.md), not a current feature inventory or completion of the full milestone. Operator syntax and limitations are in the [README](../README.md#doctor-preview-and-explain).

## Delivered

- Both `/vmodel` and `/virtual-model` support `doctor [selection]`, `preview [--allow-inference] selection -- task`, and `explain [latest|receipt-id]`.
- Doctor inspects the loaded policy, local registry, configured auth presence, text-input eligibility, effective selector and registration identity. It performs no inference, credential resolution or endpoint probe.
- Automatic preview requires explicit cost consent. Explicit-role preview bypasses selection inference. The supplied task is text-only, 1–3000 characters, with no implicit history/files/images upload or silent truncation.
- Preview uses a fresh core router without changing model/thinking selection, native task/sticky state, execution guidance or coordinator handles. Records are labeled `preview`, not dispatch, and usage appears separately as `previewSelectorAttempts`.
- Explain reproduces an exact active-branch receipt without rechecking inventory or calling a selector. Historical revisions are labeled; abandoned-branch records and authority IDs are not accepted as receipt lookups.
- Reports use UI-only custom entries with bounded expanded rendering. JSON/RPC/SDK consumers receive native `entry_appended` events; plain text print users inspect the session or choose JSON mode.
- Timeout, host cancellation, reload, concurrent previews and abandoned-branch completion have explicit handling. Unexpected core errors retain their sanitized receipt rather than provider/error prose.

## Verification

Fresh `npm run verify` after the final implementation change exited 0:

- **98 tests passed; 0 failed** — all 84 existing tests plus 14 diagnostic tests.
- TypeScript checking and JavaScript/declaration builds passed.
- Built exports, side-effect-free core graph, package contents, documentation JSON and local links passed.

Tests cover parsing/bounds; absent consent; explicit no-inference preview; registry/auth/registration diagnostics; one-decision scoped LLM preview; preserved active model/thinking/sticky assignment/guidance; pending coordinator answers; original/historical/branch-local receipt lookup; known and unknown usage; internal-error privacy; timeout/cancellation; concurrent preview rejection; reload disposal; abandoned-branch result suppression; bounded narrow-width rendering; and isolated real CLI JSON delivery without an agent turn. Providers are fixtures, not live inference.

## Compatibility and review notes

A review found the previous headless status transport used model-facing custom messages. Status/selection/setup output now uses `virtual-models.diagnostic` entries with `kind: "status"` and payload in `data.report`. Status payload fields are retained, with the separate preview summary added. SDK consumers must change their event filters; old historical messages are not rewritten. Regression tests now verify status data, as well as preview reports and task text, stays out of later execution context.

No new tool operations, dependency, routing policy, fallback, permission control, orchestration or core runtime dependency was introduced. Receipt IDs remain diagnostic, never authority. No live quality/cost claims follow from these tests. No global installation, publication, commit or pi-gsd runtime change was performed.

## Deferred and remaining limits

- Registry-based configuration scaffolding is deliberately deferred. Missing default files still show setup help; invalid policies still fail loading and must be fixed before doctor can inspect them.
- Doctor checks configured auth presence, not credential validity, endpoint health, duplicate registration ownership, image tasks or context capacity.
- Preview is not an execution-quality evaluation. Interrupted or discarded previews can incur charges without a persisted usage report; unknown charges remain unknown.
- Idle command cancellation depends on host signal availability; built-in selector deadlines remain the bound when no signal is supplied.
- Plain text print mode does not render diagnostic custom entries. JSON mode or session inspection is the documented headless path.
- Reports are at most 512 KiB; expanded TUI text is capped at 32768 characters with an explicit truncation note. These are best-effort, locally mutable diagnostics, not a tamper-evident billing ledger.
- Next is S03: offline corpus and replay, separating hard-constraint compliance from suitability. No live evaluation is implicitly authorized.
