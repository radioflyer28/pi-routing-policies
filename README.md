# pi-virtual-models

Named model policies with **LLM or native-classifier routing**, namespace-scoped automatic entries, explicit effort pins, optional role guidance, expandable routing notices, and structured decision records. Use it as a standalone Pi extension or a side-effect-free library.

**MVP, not published to npm.** Tests use isolated Pi sessions and fake providers. Live routing quality, actual endpoint availability, and virtual child-launch compatibility are not established.

## Quick start

Requires Node.js 24+ and Pi's native virtual-model APIs. Development dependencies and current checks target **Pi 1.2.0**. The earlier 149-test suite also passed on Pi 1.0.1; the new interoperability tests target 1.2.0, not every intervening or future release. See [host compatibility and upgrade guidance](docs/COMPATIBILITY.md).

```sh
npm ci --ignore-scripts
npm run verify
pi -e ./src/extension.ts
```

Alternatively, install this checkout with `pi install .`. Loading the extension does not create configuration, select a model, or make a routing call.

For interactive setup, use `/skill:routing-policy-advisor` after installing the whole package (`pi install .`); `/vmodel advisor` shows help. The bundled skill adapts grilling and domain-modeling to discover available models/prices, interview you, optionally research task-relevant benchmarks and practitioner reports with your consent, and propose a namespace. Only your explicit apply command writes it. See the [advisor guide](docs/ADVISOR.md). The assistant conversation may be billed; local discovery/proposal/apply do not run inference.

Or copy [examples/virtual-models.json](examples/virtual-models.json) to `virtual-models.json` in your Pi agent directory (normally `~/.pi/agent`). Replace **all** `replace-me` provider/model placeholders with exact physical model IDs from your Pi registry. Configure credentials through Pi, not this policy file.

`PI_VIRTUAL_MODELS_CONFIG` overrides the policy path. Agent-directory overrides are honored. No automatic project config layering occurs. A missing default file provides advisor tools and setup help; a missing explicit file or invalid policy fails loading. After editing the file, use `/reload`.

## Choose the routing backend

The root `selector` is the default for automatic routes. Both backends receive the same filtered `{ state, questions }` decision request. Neither executes the task or has execution tools.

### Native classifier / Jev

Add this field to the policy root:

```json
{
  "selector": {
    "kind": "classifier",
    "provider": "typesafe",
    "model": "jev-latest",
    "timeoutMs": 10000
  }
}
```

This calls **Pi's native `ctx.modelRegistry.classify()`**, using a model discovered with `findOfType("classifier", ...)`. It does **not** require or call the `pi-typesafe` extension. Verify that the configured classifier ID and provider credentials exist in your Pi installation.

### Dedicated LLM

```json
{
  "selector": {
    "kind": "llm",
    "provider": "your-provider",
    "model": "your-routing-model",
    "thinking": "low",
    "timeoutMs": 30000,
    "maxTokens": 2048
  }
}
```

This makes one bounded **native Pi `modelRegistry.streamSimple()`** call to the configured physical chat model. It supplies only the routing instructions and bounded decision request, with no execution tools or conversation transcript. The answer must be a complete JSON choice; fenced JSON, invented choices, incomplete answers, tool calls, errors and abstention do not trigger a fallback.

Keep provider, model and thinking separate; physical model IDs may contain slashes or colons. The selector's `thinking` is independent of virtual effort and execution thinking. Pi capability clamping is applied and the requested/effective selector levels appear in expanded diagnostics.

| Setting | Classifier | LLM |
| --- | --- | --- |
| `kind` | `classifier` | `llm` |
| `provider`, `model` | Required classifier identity | Required physical chat identity |
| `thinking` | Not supported | Required |
| `timeoutMs` | Default 10000 | Default 30000 |
| `maxTokens` | Not supported | Default 2048; configurable 128–8192 |

Timeouts accept 1–120000 ms. Cancellation is forwarded, and the caller stops waiting even if a provider ignores it. No hidden backend/provider fallback, retry escalation, or downgrade is performed. Inference that continues after cancellation may still incur charges.

## Global and namespace-scoped routes

The global automatic entry is optional and configurable. Namespaces explicitly enabled in `namespaces` each get their own scoped `namespace/auto` entry:

```json
{
  "autoModel": "router/auto",
  "namespaces": {
    "wiki": {},
    "code": {
      "selector": {
        "kind": "llm",
        "provider": "your-provider",
        "model": "your-code-router",
        "thinking": "medium"
      }
    }
  }
}
```

Merge these fields into the policy containing your `models`, `questions`, and default `selector`:

- **`wiki/auto`** selects only configured `wiki/*` variants and inherits the root selector.
- **`code/auto`** selects only configured `code/*` variants and uses its selector override.
- **`router/auto`** selects across the whole catalog using the root selector. It does **not** call a scoped router afterward. Every automatic route makes one selection and resolves directly to a physical target.
- An override supplies a complete selector configuration; it is not a partial merge of provider/model fields.
- Omit `autoModel` to preserve the backward-compatible global name `virt/auto`. Set `"autoModel": false` to disable global routing entirely. Tool calls must then specify a selection explicitly.
- `namespaces` is opt-in. A global entry named `wiki/auto` is still global unless it is configured as a scoped entry instead. A global and scoped entry cannot share an identity; use `router/auto` globally when enabling scoped `wiki/auto`.

Automatic IDs must be `namespace/auto`, without effort suffixes. Namespaces must have configured roles. Only configured entries are registered. Renaming one and reloading removes its old registrations; select the new identity explicitly afterward. Session selections are not automatically renamed.

### Effort and manual pins

| Selection | Meaning |
| --- | --- |
| `wiki/auto` | Automatic role and effort within wiki |
| `wiki/auto:high` | Automatic wiki role, fixed high effort |
| `router/auto:low` | Automatic role across namespaces, fixed low effort |
| `wiki/edit` | Explicit role at its configured default effort |
| `wiki/edit:high` | Explicit role and effort |

An effort suffix is a hard constraint. It filters candidates before selection and is checked again afterward. An unavailable/unsuitable candidate produces an error or abstention, never implicit escalation. Explicit selections bypass selectors but not eligibility checks, and remain pinned until changed.

## Commands and native Pi identities

`/virtual-model` and `/vmodel` use the same handler:

```text
/vmodel
/vmodel wiki/auto
/vmodel wiki/auto:high
/vmodel router/auto:low
/vmodel wiki/edit:high
```

Without arguments they show available selections, configuration revision, selected native identity, reported selector usage and recorded selector-invocation outcomes/unknown-usage counts. Selection changes wait until idle. Both aliases also support the diagnostic subcommands below.

Pi always supplies a thinking level, so automatic effort cannot safely be inferred from its default. The extension encodes effort in separate native IDs:

| Command/library spelling | Native picker / `--model` spelling |
| --- | --- |
| `wiki/auto` | `wiki/auto` |
| `wiki/auto:high` | `wiki/auto/high` |
| `router/auto:low` | `router/auto/low` |
| `wiki/edit:high` | `wiki/edit/high` |

```sh
pi --model wiki/auto/high
```

**Do not use a native CLI `:high` suffix to request virtual effort.** Pi treats it as its own thinking level. Virtual entries offer only `off`; the physical target still receives the policy's configured thinking level, subject to Pi clamping. Use `/vmodel` or another native effort entry, not `/thinking`, to change virtual effort.

Use unique namespaces. Trusted extensions can replace virtual registrations; this package does not isolate itself from other code running in the Pi process.

## Routing notices and context

A native routing decision appears as a compact transcript entry:

```text
Routing: wiki/auto:high → provider/model (thinking: medium)
```

**Ctrl-O** (or your configured tool-expansion key) reveals the selected policy variant, selector identity and reasoning, latency, reported usage, requested/effective execution thinking, role guidance and decision/revision IDs. Ordinary sticky tool continuations do not repeat the notice. Direct interactions, such as compaction, get an identified direct-route notice. Pi's existing routed-model footer remains unchanged.

Notices mean **chosen for dispatch**, not proof that inference completed. Router-tool results use the label **Assignment**, because resolving a worker assignment neither executes it nor switches the parent.

### What reaches the model?

- **UI notices and expanded diagnostics:** custom session entries, excluded from model context. No selector prompts, raw output, or chain-of-thought is persisted in them.
- **Router-tool results:** the resolved assignment is model-visible, so a coordinator can use it. Selector diagnostics stay in UI details.
- **Automatic execution:** no routing metadata note by default. Set `"routingContext": "assignment"` to inject a compact request-local note containing only the current selection, chosen variant and physical target. It replaces the previous note; it is not appended to history, fed to the selector, or allowed to accumulate across turns. `"routingContext": "off"` is the default.

Reported selector usage is also kept separately for `/vmodel` accounting. Native routing calls do not enter Pi's standard execution totals through private APIs. Successful `virtual_models` `select` calls additionally report their nested usage through the tool-result usage field. Do not add that tool usage to the diagnostic total again. Missing or post-timeout usage is unknown, not proof of a free call.

### Doctor, preview and explain

Use the policy spelling (`namespace/role:effort`), not the native slash-effort ID:

```text
/vmodel doctor
/vmodel doctor wiki/auto:high
/vmodel preview wiki/edit:low -- Fix a spelling mistake
/vmodel preview --allow-inference wiki/auto:high -- Review a difficult documentation change
/vmodel explain
/vmodel explain RECEIPT_ID
```

Replace the example selections with ones in your configured policy. These commands never switch the active model or thinking level, apply role guidance, launch execution, or change sticky assignments or pending coordinator handles.

| Command | Behavior and inference cost |
| --- | --- |
| `doctor [selection]` | Checks the **loaded** policy against current local registry, configured auth presence, text-input eligibility, effective selector configuration and registration identities. No selector call, credential refresh, endpoint probe or configuration write. |
| `preview [--allow-inference] selection -- task` | Resolves a proposal using normal constraints. Automatic selections require **`--allow-inference`** because a selector call may incur charges. Explicit roles bypass inference and do not need the flag. No execution model is called. |
| `explain [latest\|receipt-id]` | Displays the original decision receipt on the active branch, including preview failures. Defaults to `latest`. Uses the exact receipt ID, not its authority/decision ID. No selector call or current eligibility recheck; historical policy revisions are labeled. |

Preview sends only the supplied **text task, 1–3000 characters**, and the normal filtered policy question. It never reads the latest prompt, conversation history, files or images. Oversized tasks are rejected rather than silently truncated. No task text is copied into diagnostic entries. Ordinary host command-history behavior is outside this guarantee.

Reports persist as UI-only `virtual-models.diagnostic` custom entries. Expand them in the TUI; expanded text is capped at 32768 characters with an explicit truncation notice, while the full report remains in the entry (maximum 512 KiB). SDK subscribers and JSON/RPC clients receive `entry_appended` events. Plain text print mode does not print these entries—use `--mode json` or inspect the saved session. Diagnostics never use model-facing custom messages or trigger an agent turn. Headless status/selection/setup output now also uses these entries (`kind: "status"`, payload in `data.report`), replacing the earlier `virtual-models.status` custom-message transport. SDK consumers should update their event filters; existing historical messages are not migrated.

Preview receipts carry `source: "preview"`; `/vmodel` reports their usage separately as `previewSelectorAttempts`. They are not dispatch records and are not added to legacy native/tool usage totals. Unknown charges remain unknown. Only one preview runs at a time. Host cancellation, when available, is forwarded; otherwise the configured selector timeout bounds the wait. Reload/shutdown cancels pending previews. Results from an abandoned branch or replaced session are discarded rather than attached to the new branch; such calls can still have incurred charges without a persisted receipt.

Doctor is not a live credential/endpoint check, context-capacity assessment, duplicate-owner proof, or image-task certification. Invalid policies still fail extension loading; a missing default policy still provides setup help. Correct the file and `/reload` before checking it. Automatic registry-based config generation is deferred; nothing is scaffolded implicitly.

### Decision records

Native and router-tool decisions persist bounded version-1 records as UI-only custom entries. Successful notices gain candidate/exclusion details when expanded; failures have their own expandable entry. Successful records and sticky revalidations do not add duplicate compact notices.

Records identify the operation, configured selection, latest candidate checks, stable exclusion/error codes, policy revision, timing, and selector invocation outcome. They do **not** retain task text, selection criteria, arbitrary inventory/error prose, raw answers or chain-of-thought. Assignment/tool content does not acquire diagnostic fields.

- `selectorAttempts` counts **method invocations from terminal records**, not HTTP attempts or billable requests. In-flight calls and calls lost to a process crash have no terminal record.
- Reported tokens/cost can survive a response-validation failure. Unreported values are `null` in records, not zero; a reported zero remains zero.
- Attempt totals and the existing reported-usage totals overlap. Do not add them together or to tool/generation billing totals again.
- Records describe resolution, not completed inference or task success. A returned selector response can still produce a rejected assignment.
- Persistence/observation is best-effort. These records are not an authoritative billing ledger. Older sessions can contain usage entries without decision records.

## Optional role guidance—not tool permissions

A configured role can provide soft instructions to its execution model:

```json
{
  "wiki/edit": {
    "instructions": "Prefer tool XYZ for source lookup. Avoid tool ABC unless the user asks for it.",
    "defaultEffort": "medium",
    "efforts": {
      "medium": { "provider": "your-provider", "model": "your-editor", "thinking": "low" }
    }
  }
}
```

This snippet belongs inside `models`; add matching criteria to `questions.route` as with any role. Guidance applies to every effort of that role and is limited to 4096 characters.

- Native session routing injects only the current resolved role's guidance into the execution request, without accumulating old roles in history.
- Guidance is **not sent to the selector**. `questions.route.instructions` remains the separate instruction to the router.
- Library/tool assignments return `instructions` for the intended worker. Consumers choose how to apply it; resolving a child assignment does not apply its instructions to the parent.
- Configuring role instructions opts into that guidance independently of `routingContext`.
- There is **no tool-permission configuration**. Guidance does not enable, disable, allow, or block tools. Pi, its profiles and the consuming workflow own actual permissions.

## Native dialogue context and affinity (opt-in)

Without `nativeRouting`, automatic routing still selects per user turn using the latest user's first 3000 characters, `taskTruncated` and `hasImages`. Tool continuations/retries remain sticky. To let a short reply such as “yes, proceed” refer to earlier dialogue, merge this fragment into your policy and `/reload`:

```json
{
  "nativeRouting": {
    "context": {
      "previousMessages": 3,
      "maxHistoryChars": 8000,
      "maxMessageChars": 3000,
      "includeAssistant": true,
      "truncation": "head-tail"
    },
    "affinity": "turn"
  }
}
```

The selector receives the current `task` plus role-labeled `recentDialogue` excerpts and truncation flags. Including assistant text lets an approval refer to the assistant's plan. Routing code assembles this input; the selector cannot request more history or change these limits. The execution model still receives Pi's normal execution context, not this shortened routing view.

| Option | Meaning |
| --- | --- |
| `context` absent | No prior dialogue. Preserve latest-user-prefix behavior. |
| `previousMessages` | 0–8 prior nonempty messages; default 3 when context is enabled. Counts both roles when assistant inclusion is enabled. Zero disables history. |
| `maxHistoryChars` | Total prior-text budget, 0–8000; default 8000. Zero disables history. |
| `maxMessageChars` | Current-task and individual history-text cap, 128–3000; default 3000. |
| `includeAssistant` | Default false. Set true explicitly to share assistant text with the selector provider. |
| `truncation` | `head-tail` (default inside `context`) preserves the beginning/end with an ellipsis; `prefix` keeps the beginning; `error` rejects oversized selected text before inference. |
| `affinity` | `turn` (default) selects per new user turn; `session` reuses the current automatic assignment across user turns until selection changes or explicit reselection. |

Character limits count UTF-16 code units, **not tokens**. The current task has priority; recent history gets the remaining budget, newest first, and is presented chronologically. The complete serialized state is also limited to 16 KiB, including UTF-8 and JSON escaping; it may clip earlier than the character caps. Expanded routing notices show only counts/flags, not excerpts. Clipping can lose important middle requirements; use `error` when silently losing selected text is unacceptable. Older messages outside the configured window are omitted in every mode.

**Privacy:** admission includes only actual user/assistant text present in the current request and Pi session projection. It excludes tool results/arguments, reasoning, system/custom messages, execution guidance and synthetic compaction/branch summaries. It does not recover compacted-away history, read files or send image contents. Text pasted by a user or echoed in assistant prose can still contain secrets—this is not redaction. Native context settings do not add history to library calls, `virtual_models`, or diagnostic preview.

### Keep an assignment across follow-ups

Set `"nativeRouting": { "affinity": "session" }` to enable affinity independently of dialogue context. Every reuse still checks eligibility. Affinity does not detect task changes: a session that starts with easy work can retain that assignment for later difficult work.

When the task changes, use either command alias:

```text
/vmodel reselect
/virtual-model reselect
```

This resets the current automatic assignment **without inference or a model/thinking change**. The next normal request selects again and may incur selector charges. It does not delete recent dialogue or alter sharing limits. Explicit/physical selections reject this command; select the desired automatic entry first. Tools cannot enable affinity or expand the context policy. No durable brief, automatic summary or coordinator fallback is introduced.

## Lifecycle and safety

Assignments stick through continuations/retries, and across user turns only with session affinity enabled. Task/selection identity prevents a failed fresh selection from reviving an unrelated assignment. Unchanged reload/resume and compaction preserve a pin. Forks and tree navigation inherit only ancestral branch state; resets on one branch do not affect another. New sessions start without an assignment.

Policy revisions invalidate stale decisions. Under default turn routing a new user turn can select again; with session affinity, a matching stale pin fails closed until `/vmodel reselect` or a deliberate selection change. Missing auth, revoked targets or new unsupported inputs likewise error rather than trigger silent replacement. Physical identity/type, configured auth, input compatibility, effort and namespace constraints are rechecked. Pi performs request-time credential handling and physical thinking clamping. A text selector does not understand image contents; use an explicit policy when visual semantics are necessary for choosing a route.

Results from a changed selection epoch, abandoned branch or replaced session are rejected before dispatch and are not attached to that new context. A discarded selector call may still have incurred unrecorded charges.

Direct requests reuse the current validated assignment without classifying a summary prompt. Without an automatic assignment, configure a physical `direct` target or select an explicit policy:

```json
{
  "direct": { "provider": "your-provider", "model": "your-summary-model", "thinking": "medium" }
}
```

This is an explicit direct-call target, not an optimizer or fallback for failed task selection. Soft role guidance and request-local metadata are injected through the agent execution-context hook, not into separate direct/compaction calls.

## Capacity admission (opt-in)

Capacity checks concern **execution input**, not the selector's small task window. Library/tool callers can supply `capacity` constraints with an input estimate, output reserve and source. Inventory callbacks may return physical `contextWindow` / `maxOutputTokens` observations; existing callbacks need no changes unless capacity is requested.

- `require-estimated-fit` rejects unknown or insufficient input/output capacity.
- `allow-compaction` can admit excess/unknown input for consumer-managed compaction, but still rejects unknown/insufficient output limits or a reserve that cannot fit alone.
- Checks filter candidates before inference and revalidate accepted/sticky targets. No scope/effort override, fallback, generation-budget change or automatic compaction is introduced.
- Requirements persist with constrained assignments. Refresh the input estimate as execution context changes; omitting it during library revalidation retains the old estimate rather than measuring anything.

Native routing supports `nativeRouting.capacity` with an explicit mode/output reserve and optional `inputEstimate: "pi-heuristic"`. The default estimate is unknown, so strict native admission blocks unless an estimate strategy is selected. Pi's heuristic counts the full routing request locally, not a clipped task or prior provider usage. Images and this extension's later guidance/assignment-context additions yield unknown input. Direct/compaction requests use strict checks against their own input rather than assuming they can compact themselves.

A passing estimate is **not a final-payload or output-token guarantee**. Pi can transform or compact later and apply provider-specific output/thinking limits. See the [capacity guide](docs/CAPACITY.md) for configuration, caller examples, unknown semantics and diagnostics, and [ADR 0002](docs/adr/0002-capacity-is-admission-not-execution.md) for the pinned-host evidence. Preview does not certify execution capacity from its diagnostic task.

## Coordinating LLM tool

`virtual_models` never changes the parent selection or launches work:

| Action | Result |
| --- | --- |
| `list` | Catalog, routing policy and resolved automatic-entry/selector configuration |
| `resolve` | Deterministic explicit assignment |
| `select` | One automatic decision using that entry's configured LLM/classifier |
| `prepare` | Decision ID plus filtered `{ state, questions }` for an existing coordinator |
| `answer` | Validated assignment from that coordinator's offered choice |

`select` and `prepare` accept task `state`, `selection`, optional `allowedChoices`, `requiredInputs` and `capacity`. Omitted selection uses the configured global entry; if global routing is disabled it must be supplied. `answer` takes `decisionId` and `choice`. Explicit `resolve`, and `select` with an explicit role, need no selector call.

Pending coordinator decisions are single-use, limited to 32, expire after five minutes and are lost on reload. They are session/branch-bound correlation handles, not security tokens. Model-supplied restrictions are not trusted authorization; the consuming integration must enforce its own restrictions and delegation rules.

## Library use

Build first. Importing the core performs no ambient config reads, registration, selector calls or session changes:

```ts
import { createRouter } from "pi-virtual-models/core";
import { createSelector } from "pi-virtual-models/selectors";

// Supply an inventory that checks current physical identity/type, auth,
// inputs, and consumer-specific restrictions.
const router = createRouter(config, inventory);
const selection = "wiki/auto:high";
const selector = createSelector(ctx.modelRegistry, router.policy.automatic["wiki/auto"].selector);
const { assignment, metadata } = await router.select(
  selection, { task: "Reconcile the supplied sources." }, selector,
  { requiredInputs: ["text"] }, signal,
);
await router.revalidate(assignment, { requiredInputs: ["text"] }, signal);
// Consumer executes assignment.target and may apply assignment.instructions.
```

For an existing coordinating LLM, use `router.prepare()` and `router.accept()` instead of making another model call. The normalized answer needs no confidence estimate:

```json
{
  "answers": {
    "route": { "type": "choice", "choice": "wiki/edit:high" }
  }
}
```

`createRouter` freezes its policy. Decision objects are immutable, single-use, in-memory handles belonging to that router instance; reconstructed/serialized handles are rejected. Assignments are serializable but must be revalidated, not treated as authority.

To observe decisions, supply the optional third argument:

```ts
import type { DecisionReceipt } from "pi-virtual-models/core";

const receipts: DecisionReceipt[] = []; // Example sink; production consumers own retention.
const observedRouter = createRouter(config, inventory, {
  onReceipt(receipt) { receipts.push(receipt); },
});
```

Each public `resolve`, `prepare`, `accept`, `select` or `revalidate` call delivers one immutable terminal record; nested preparation/acceptance inside `select` does not duplicate it. Calls on one router may overlap and have distinct receipt IDs. The observer is invoked synchronously, is not awaited, and its throws/rejections cannot replace the routing result or error. It does not receive task state. Configuration errors before router construction cannot produce a receipt.

Inventory implementations can return a stable `code` with an ineligible result: `model_missing`, `not_physical`, `auth_missing`, `input_unsupported`, `restricted` or `inventory_rejected`. Unknown codes become `inventory_rejected`; the existing optional `reason` prose remains supported but is deliberately not copied into records. Scope/effort/allowlist exclusions are recorded separately. Records contain only checks performed, with the last eligibility check for each choice; they are not decision handles or authority.

`policy.automatic` describes every enabled automatic entry with its scope and resolved selector. `policy.autoModel` is the global identity, or `undefined` when disabled. Standalone parsing accepts `parseSelection(value, Object.keys(policy.automatic))`; router methods bind this automatically. Dedicated factories are also exported from `pi-virtual-models/classifier` and `pi-virtual-models/llm`.

Library imports do not activate the UI or inject guidance. Native registration has one explicit owner, not a shared singleton. SDK startup should use Pi's `createAgentSessionServices()` then `createAgentSessionFromServices()` so registrations exist before model selection.

## Offline evaluation and replay

```sh
npm run evaluate
npm run evaluate -- --split tuning
npm run evaluate -- --split all
```

The default runs the **20-case holdout** half of a frozen 40-case synthetic corpus. It replays supplied answers through the real core with fixture inventory—no credentials, provider calls, session access or execution dispatch. Explicit pins, scopes, effort, allowlists, input eligibility, revocation and fail-closed rejection are checked separately from whether proposed choices match human-authored suitability labels.

The bundled answers deliberately contain misses and errors. They are **regression fixtures, not measured model quality**. Reports show scored/unscored populations and separate split summaries, with corpus/policy/answer/selector provenance and a CLI implementation fingerprint. Empty suitability populations remain `null`. Exit 0 means mechanical checks passed, not that every proposal was suitable.

Custom artifacts use `--corpus FILE --answers FILE`; `--out NEW_FILE` writes without overwriting. Task text and raw answers live only in the explicit input artifacts, not ordinary decision receipts or the report. There is no live mode. See [evaluation workflow and artifact contracts](docs/EVALUATION.md) for bounds, metric definitions, privacy and future live-capture approval requirements.

## Verification and remaining scope

```sh
npm run test:compat
npm run verify
```

`test:compat` runs the focused Pi 1.2.0 interoperability regressions and checks the installed host-package versions. It is not a substitute for the full verification below. See [compatibility and upgrade guidance](docs/COMPATIBILITY.md) for custom-message runs, changing OpenRouter catalogs and Azure provider migration.

This runs typechecking, fake-provider core/SDK/CLI tests, declaration/JavaScript builds, and package/example/documentation checks, including offline replay of the synthetic corpus through the built evaluator. It does not use live credentials or establish live routing quality. If npm's release-age policy blocks pinned development dependencies, wait or obtain approval for a command-scoped exception; do not disable the global policy.

Out of scope: automatic project layering, fixed-role automatic effort, budget optimization, cross-provider retry fallbacks, tool-permission management, orchestration and verified virtual child launches. Until child startup and physical-target restrictions are independently tested, resolve physical assignments in the parent. No pi-gsd integration is activated by this package.

The source is licensed under [Apache 2.0](LICENSE); adapted advisor skill material retains its [upstream MIT notice](skills/routing-policy-advisor/LICENSE). The project is hosted at [radioflyer28/pi-virtual-models](https://github.com/radioflyer28/pi-virtual-models). The manifest remains `private: true` to prevent accidental npm publication; npm publication and name availability remain separate decisions.

- [Pi compatibility and upgrade guidance](docs/COMPATIBILITY.md)
- [Changelog](CHANGELOG.md)
- [Design and research](docs/DESIGN.md)
- [Competitive routing review and prioritized gaps](docs/MODEL-ROUTING-COMPETITIVE-REVIEW.md)
- [Conversation context and continuity in existing routers](docs/ROUTING-CONTEXT-REVIEW.md)
- [Decision: bounded dialogue and explicit affinity](docs/adr/0001-bounded-dialogue-and-affinity.md)
- [S04 completion and verification](docs/M001-S04-SUMMARY.md)
- [Capacity admission guide](docs/CAPACITY.md)
- [S05 completion and verification](docs/M001-S05-SUMMARY.md)
- [Interactive policy advisor](docs/ADVISOR.md) and [S06 completion](docs/M001-S06-SUMMARY.md)
- [Decision: capacity admission versus execution control](docs/adr/0002-capacity-is-admission-not-execution.md)
- [Routing improvements milestone](docs/M001-CONTEXT.md) and [slice roadmap](docs/M001-ROADMAP.md)
- [Implementation notes](docs/IMPLEMENTATION.md)
- [Offline evaluation and replay](docs/EVALUATION.md)
- [Complete example policy](examples/virtual-models.json)
