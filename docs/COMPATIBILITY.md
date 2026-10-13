# Pi host compatibility and upgrade guidance

## Tested baseline

The development dependencies `@earendil-works/pi-coding-agent`, `pi-ai` and `pi-tui` are pinned to **1.2.0**. Use Node.js 24+ and run `npm ci --ignore-scripts`, then `npm run verify`. Host-provided packages remain optional wildcard peers, following Pi's package contract; this is not a promise that all host versions work. Core-only consumers still need no Pi runtime.

Before this update, the original 149-test suite, typecheck, build, package/documentation checks and 40 built offline replay cases passed against both Pi 1.0.1 and an isolated installed 1.2.0 dependency tree. Current regression coverage includes 1.2.0-specific lifecycle behavior; historical slice summaries and ADR source findings remain snapshots of their original baseline, not current compatibility claims.

Verification for this update: `npm run test:compat` passed **14 tests**; `npm run verify` passed **163 tests** (149 existing + 14 new), typecheck, JavaScript/declaration build, package/documentation checks and **40 built offline replay cases**. The installed host dependency tree contains Pi 1.2.0 without duplicate older Pi packages.

No live credentials or provider calls are used by these checks. Catalog mutation tests simulate the registry consequences of credential-scoped catalogs; they do not test OpenRouter's HTTP endpoint, guardrails, refresh timing or authentication. Virtual child launches and arbitrary third-party extension combinations remain unverified.

## Extension-triggered runs

Pi 1.2.0 runs `before_agent_start` for idle `pi.sendMessage(..., { triggerTurn: true })` calls as well as user prompts. Its event is discriminated by `messageType`: custom runs have `message`, not `prompt`. Pi also counts startup as busy, queues messages sent during startup, and honors startup cancellation.

This package does not register a `before_agent_start` handler. It applies role guidance through the request-local `context` hook, preserving other extensions' prompt sections and setup messages. Companion handlers that read `prompt` must first check `event.messageType === "user"`; do not call command-only `waitForIdle()` from a lifecycle handler.

A custom run can reuse a current validated automatic assignment as a continuation; it is not a new user task. Custom messages remain excluded from selector input even though Pi converts them to user-role execution messages. Without an admitted real user task, automatic selection fails before inference; use an explicit policy for custom-only startup. An old real user task still present in the projection can be used when fresh routing is needed, but custom text is never substituted for it. If a companion integration wants a genuinely new user task, it should use Pi's user-message interface under its own authorization rules.

Tests cover both selector backends, sticky reuse/no duplicate notices, non-accumulating guidance, busy startup, returned and queued setup messages, prompt-section persistence through tools, startup abort and `agent_settled.aborted`.

## OpenRouter and changing catalogs

Pi 1.2.0 can list only the OpenRouter chat models permitted for a key, using that key's context/output limits and prices. The extension reads Pi's current registry rather than fetching a catalog itself:

- Removed targets are excluded before selection and rechecked after a selector returns.
- A removed or undersized sticky target fails closed; no replacement, effort escalation or provider fallback occurs.
- With session affinity, use `/vmodel reselect` to request a new assignment on the next normal request. A fixed effort can still have no eligible choices after reselection.
- Capacity limits are enforced only when capacity admission is configured. They remain estimates/admission checks, not final payload or generation guarantees.
- `/vmodel doctor` checks the currently loaded registry, not live endpoint availability or credential validity.

Pi owns catalog refresh. Its 1.2.0 provider docs say interactive startup, `/model`, `/login` and `pi update --models` can refresh the catalog; offline/print/RPC modes use saved data. Switching keys outside `/login` can leave the previous catalog until refresh. Proxies without `/models/user` or endpoints rejecting the key may cause Pi to list the full catalog. Thus local eligibility is not proof of remote authorization, and this package does not certify or enforce OpenRouter guardrails.

## Azure migration from the old baseline

Pi renamed `azure-openai-responses` to `azure` in 1.0.3. If upgrading from the earlier baseline, change that provider ID in policy execution variants, LLM/classifier selectors where applicable, and the optional direct target. Also update the corresponding provider references in Pi's auth/models/settings configuration as instructed by Pi, or log in again. This package never rewrites credentials or provider names automatically. Reload the policy and inspect it with doctor; policy changes invalidate prior assignments.

## Other release changes

- Pi 1.2.0 compaction serialization omits assistant thinking. The regression checks visible evidence remains available to the summary request while reasoning is omitted and direct routing reuses the physical assignment without a new selector call.
- Added tool render timing/padding fields do not require this package to replace Pi's renderer shell. Existing compact/expanded renderer tests remain part of verification.
- `virtual_models` resolves assignments and does not execute other tools, so it does not declare `reachesTools`. That field is for bridges/loaders such as codemode and tool search, not nested model inference.
- Pi's published configuration schemas validate Pi settings/models/keybindings/themes, not this package's separate policy. Do not add a Pi settings/models `$schema` URL to `virtual-models.json`; the strict policy parser remains authoritative.
- New image-capable classifiers do not expand this package's selector data contract: image presence is metadata, not image content. Use an explicit route when choosing a model requires visual semantics.

## Ongoing acceptance

Run the complete suite whenever changing host dependencies; do not infer compatibility from successful imports or a wildcard peer range. `npm run test:compat` runs the focused host-interoperability regressions; `npm run verify` runs them together with the broader SDK/CLI suite, typecheck, build and package checks. A version guard checks the installed Pi packages against the pinned 1.2.0 baseline so a stale dependency tree cannot silently stand in for the claimed host. When upgrading again, review the guard and release-specific assertions together.

This follow-up contributes to [M001 S07](M001-ROADMAP.md) but does not close it: combined acceptance scenarios and duplicate-install/collision ownership diagnostics still need their planned review. [S06](M001-ROADMAP.md) remains a separate measurement/optimization decision. No live quality, savings, publication, global installation or virtual-child compatibility claim follows from this update.

## Host references

- [Pi 1.2.0 changelog](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/CHANGELOG.md)
- [Extension events and concurrency](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/extensions.md#events-and-concurrency)
- [Virtual models](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/virtual-models.md)
- [Provider setup and catalog refresh](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/providers.md)
- [Host-provided package dependencies](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/packages.md#declare-dependencies)
