# Conversation context and continuity in existing routers

Historical research note. The resulting accepted S04 scope is recorded in [ADR 0001](adr/0001-bounded-dialogue-and-affinity.md); it defers the durable-brief recommendation below. See [S04 completion](M001-S04-SUMMARY.md) for verified implementation behavior.

## Scope and evidence

Follow-up research for S04: how existing systems interpret short follow-ups such as “yes, proceed.” This is documentation/source inspection, not a runtime benchmark, adoption audit or approval to implement a different S04 design. Established projects and published features are not proof of reliable multi-turn task routing. LiteLLM explicitly labels its Auto Routing page beta; its context support is documented as introduced in v1.96.x. Rolling documentation/source may change.

## Findings

### LiteLLM Auto Router: bounded prior dialogue, with optional affinity

The current [Auto Routing documentation](https://docs.litellm.ai/docs/proxy/auto_routing#classifier-context-window) explicitly addresses follow-up context. Its LLM/JEV classifiers receive up to three prior user turns by default, within an 8000-character **prior-turn** budget. The current ask and extracted system text are separate from that budget. An optional per-turn cap exists; window size zero disables prior context. Prior turns are presented chronologically and clipped excerpts are marked. The heuristic scorer does not use this same prior-turn window.

[Extraction rules](https://docs.litellm.ai/docs/proxy/auto_routing#what-gets-classified) find the latest real human text, skipping tool-output-only messages and stripping configured reminder blocks. Tool-role outputs and tool-result blocks do not qualify for this conversation window. This avoids treating a huge log or harness-injected text as the user task. Extracted caller system text can be quoted into classifier context; this is a different privacy policy from our current default.

[Assistant turns](https://docs.litellm.ai/docs/proxy/auto_routing#assistant-turns-in-the-context-window) are opt-in. The docs name the exact problematic exchange: the assistant offers a complex plan, the user says “yes,” and user-only history misses what was approved. Enabling assistant turns makes the window count both roles. The docs explain the default-off choice: it changes routing/spend and sends additional assistant text to a potentially different provider.

[Auto Router session affinity](https://docs.litellm.ai/docs/proxy/auto_routing#session-affinity) optionally pins the first-turn model and skips reclassification on subsequent session requests. It is documented as off by default and requires a resolvable session ID. This reduces switching and cache churn, but the first choice can be wrong for a later task. Do not confuse this with [deployment affinity](https://docs.litellm.ai/docs/routing), which pins a concrete deployment within a model group and has its own recovery behavior. We should not copy LiteLLM's fallback/escalation policies merely to borrow its context handling.

### Not Diamond: the caller supplies message context

The [routing quickstart](https://docs.notdiamond.ai/docs/quickstart-routing) and [/modelSelect reference](https://docs.notdiamond.ai/reference/token_model_select_v2_modelrouter_modelselect_post) accept OpenAI-format `messages` and optional tool definitions. The reference describes routing based on those supplied messages. A client can supply relevant conversation history instead of only the newest utterance; this API does not itself select history from an application's session.

`previous_session` is documented as linking related requests. That is not sufficient evidence that callers can omit history or that the service automatically reconstructs it. The inspected pages do not disclose an exact internal truncation/window policy or establish multi-turn coding-task reliability.

### Pi-specific alternatives: structured excerpts and pinning

Pinned [@alexeiled/pi-model-router 0.9.2 context source](https://cdn.jsdelivr.net/npm/@alexeiled/pi-model-router@0.9.2/extensions/context.ts) builds separate `currentRequest`, `recentDialogue` and `recentToolEvidence` fields for Jev. It prioritizes current request text, allocates bounded history from earlier user turns and their final textual assistant responses, optionally includes the latest tool result according to policy, and emits truncation/budget metrics. Its excerpt helper preserves head and tail rather than blindly keeping only a prefix. Thinking and tool-call argument blocks are excluded from that structured text path. This is implementation evidence, not measured superiority.

Pinned [pi-jev-router 0.5.0 README](https://cdn.jsdelivr.net/npm/pi-jev-router@0.5.0/README.md) documents “choose once, stay pinned.” The model/initial effort survive tool calls, compaction and reload/resume. New/forked/cloned sessions choose afresh. Monitoring may suggest a fork rather than automatically change model. Routing/monitoring use bounded recent user/assistant text; long tasks have a separate chunking policy. That design explicitly trades repeated task detection for stable assignment. Its retries, initial fallback, optional adaptive effort and additional cost/privacy behavior are not our desired defaults.

See the earlier [competitive review](MODEL-ROUTING-COMPETITIVE-REVIEW.md) for the broader pinned Pi comparison and its evidence limitations.

### Counterexample: RouteLLM does not establish this problem is solved

The inspected [RouteLLM controller source](https://github.com/lm-sys/RouteLLM/blob/main/routellm/controller.py) routes from `messages[-1]["content"]`. Its own comment says the routers were trained on first-turn data and that more research is needed. Accepting a chat-shaped API or having strong single-turn benchmark results does not imply the router reasons over conversation history or solves “yes, proceed.” This is a rolling source reference, not a claim about every fork/version.

## Implications for S04 (recommendation, not implementation)

The earlier brief-centric explanation was too narrow if the desired experience is automatic conversational routing. Explicit task state/briefs are useful, but need not require users to summarize every task manually.

A practical design to discuss before implementation:

1. Preserve the current narrow default for compatibility/privacy, but offer explicit opt-in bounded dialogue context.
2. Include latest human text plus a small role-labeled user/assistant window. Assistant context is essential for interpreting approval of an assistant-written plan; user-only history cannot always do it.
3. Exclude tool logs, tool arguments, reasoning and system/harness text by default. Any later tool-evidence mode needs separate bounds and consent, not a generic last-N-messages dump.
4. Add optional task-scoped affinity and explicit new-task/reselect controls. Affinity solves repeated classification, not changing-task detection. Revalidate constraints and never silently fall back.
5. Keep an explicit brief as optional durable context for long-running or resumed tasks, not the only way short follow-ups become meaningful.
6. Specify token/character budgets and visible truncation, with long-input suffix tests. A tiny assistant prefix can omit the very plan being approved.
7. Add real multi-turn request-construction and lifecycle fixtures before behavior changes. S03's public single-request corpus/replay does not prove these conversational semantics or live routing quality.

No S04 behavior was changed by this research. No live provider calls, installations, delegation or benchmark runs were performed.
