# S05 completion — opt-in execution-capacity admission

S05 adds conservative, explicitly qualified admission for execution input and output reserve. It does not turn routing into a tokenizer, execution-budget controller or compaction engine. The contract and pinned Pi 1.0.1 source findings are recorded in [ADR 0002](adr/0002-capacity-is-admission-not-execution.md); usage is documented in the [capacity guide](CAPACITY.md).

## Delivered

- Optional `Constraints.capacity` for core resolve/prepare/select/revalidate and coordinator tool calls. Explicit input count/null, output reserve, source enum and mode are validated/snapshotted. Existing calls remain unchanged.
- Optional inventory `capacity` observations for context window and output ceiling. Missing/zero/invalid limits normalize to unknown; no free-form provider data enters assessments.
- Strict `require-estimated-fit` and qualified `allow-compaction` modes. Output failures and impossible reserves exclude in both modes. Only compaction-permitted mode can admit excess/unknown input or an unknown context window, retaining the exceeded/unknown status.
- Pre-selector filtering and post-answer/current-inventory rechecks without widening namespace, effort or allowlist. Stable exclusions: `capacity_unknown`, `capacity_context`, `capacity_output`.
- Requirements retained with constrained assignments and single-use prepared decisions. Revalidation can refresh input and strengthen requirements but cannot silently drop the original mode/output reserve. Caller estimates still require caller-maintained freshness and are not authority.
- Native opt-in capacity policy. Input is unknown by default; explicit `pi-heuristic` estimates the full current routing request locally through Pi's public helper, not the selector window or old provider usage. Images/later own context additions remain unknown. Affinity refreshes estimates before each dispatch.
- Direct/summary requests use strict admission against their own input; no recursive compaction, summary classification or borrowed main-request estimate. Failed explicit direct-target checks use a bounded `direct` candidate record.
- Numeric-only receipt/expanded-notice details, configured capacity in status/doctor, and an explicit preview warning that execution capacity is not assessed from a diagnostic task. The standalone pure `assessCapacity` export checks capacity only, not full routing eligibility.

## Host findings and deliberate limits

Pi routes before its physical-model compaction check and later context transforms. Its usage display can refer to previous model usage or be null after compaction. Public token estimation is heuristic; provider adapters can clamp/adjust output and reasoning budgets. Therefore admission does not disable compaction, change generation options, certify final payload fit or promise output answer tokens. Permitting compaction does not certify enablement or success. Strict native admission with an unknown estimate deliberately fails closed.

No homemade tokenizer, capacity-driven fallback/retry, budget downgrade, automatic role/effort escalation, new coordinator authority or workflow ownership was introduced. Users needing exact provider counts or enforced final-payload/no-compaction guarantees need a separate execution contract.

## Verification

Fresh `npm run verify` after final code/test changes passed **149 tests, 0 failures**: 128 existing tests plus 21 new tests (8 core capacity tests and 13 native/helper/tool cases). Typecheck, JavaScript/declaration build, public exports/core dependency graph, JSON examples, recursive Markdown links, package checks and all **40 compiled offline replay cases** passed.

Coverage includes exact-fit boundaries, zero/null/invalid counts, invalid configuration, scope/effort/allowlist preservation, no-inference exclusions, immutable prepared constraints, capacity reduction during selection, retained/strengthened revalidation requirements, both selector backends, full-request system/tool/assistant text estimation without historical usage reuse, unknown images/guidance, growing sticky input, no generation-cap mutation, compaction-disabled qualification, actual manual compaction and resume, metadata refresh on reload, direct strict checks, coordinator retention and diagnostic non-certification. Maximum 192-candidate receipts remain below 64 KiB with capacity observations; narrow-width rendering remains covered.

The frozen S03 corpus and answers are unchanged. Its version-1 artifact schema does not accept capacity constraints; S05's deterministic boundary/lifecycle tests provide this slice's evidence, not a fabricated routing-quality benchmark. CLI implementation fingerprints automatically include the new core source module.

The focused boundary review checked primitive-only requirements/observations, source enum validation, retained single-use constraints, non-context diagnostics, and absence of new inference or authority paths. It is not an independent security audit. No live provider/tokenizer/quality/cost certification follows from fake-provider tests.

## Remaining work

S06 is a measurement/decision gate: add optimizations only if evidence justifies them, otherwise explicitly defer. S07 remains integrated lifecycle/compatibility acceptance. No delegation, new dependencies, global install, live credentialed inference, commits, publication or pi-gsd runtime changes occurred in S05.
