import { closeSync, openSync, readSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { getAgentDir, keyHint } from "@earendil-works/pi-coding-agent";
import { clampThinkingLevel } from "@earendil-works/pi-ai";
import type { Usage } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createRouter, parsePolicy, RoutingError } from "./core/index.ts";
import type { Assignment, Decision, DecisionReceipt, Router } from "./core/index.ts";
import { DECISION_RECEIPT_TYPE, receiptFromEntry, registerDecisionRenderer, summarizeSelectorAttempts } from "./decision-notice.ts";
import { createVirtualDefinitions, currentRouteState, nativeEntries, physicalModel, piInventory, RESELECT_TYPE } from "./pi-adapter.ts";
import { contextOptions } from "./native-context.ts";
import { registerExecutionContext } from "./execution-context.ts";
import { DIAGNOSTIC_TYPE, registerDiagnostics } from "./diagnostics.ts";
import { createSelector } from "./selectors.ts";
import { registerAdvisor } from "./advisor.ts";
import { registerRoutingRenderer, renderRoutingNotice, ROUTING_NOTICE_TYPE, selectorDiagnostics } from "./routing-notice.ts";
import type { RoutingNotice } from "./routing-notice.ts";

const MAX_CONFIG = 262_144;
export function loadConfig(file: string): unknown {
  const fd = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(MAX_CONFIG + 1);
    let total = 0;
    while (total < buffer.length) {
      const size = readSync(fd, buffer, total, buffer.length - total, null);
      if (!size) break;
      total += size;
    }
    if (total > MAX_CONFIG) throw new RoutingError("INVALID_CONFIG", "Policy file exceeds 256 KiB");
    try { return JSON.parse(buffer.subarray(0, total).toString("utf8")); }
    catch { throw new RoutingError("INVALID_CONFIG", "Policy file contains invalid JSON"); }
  } finally { closeSync(fd); }
}
function display(pi: ExtensionAPI, ctx: ExtensionContext, content: unknown): void {
  const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  if (ctx.hasUI) ctx.ui.notify(text, "info");
  else pi.appendEntry(DIAGNOSTIC_TYPE, { version: 1, kind: "status", report: content });
}
function registerModelCommand(pi: ExtensionAPI, command: Parameters<ExtensionAPI["registerCommand"]>[1]): void {
  pi.registerCommand("virtual-model", command);
  pi.registerCommand("vmodel", command);
}
/** Explicit factory seam for SDK consumers/tests. No file discovery or global singleton. */
export function registerVirtualModels(pi: ExtensionAPI, input: unknown, configPath = "injected"): void {
  if (typeof pi.registerVirtualModel !== "function") throw new Error("pi-virtual-models requires Pi 1.0+ native virtual models");
  const policy = parsePolicy(input);
  registerExecutionContext(pi, policy);
  registerRoutingRenderer(pi);
  registerDecisionRenderer(pi);
  const diagnose = registerDiagnostics(pi, policy);
  const advise = registerAdvisor(pi, { ...(configPath === "injected" ? {} : { file: configPath }), loaded: policy });
  const recordReceipt = (receipt: DecisionReceipt, source: "native" | "tool") => pi.appendEntry(DECISION_RECEIPT_TYPE, { source, receipt });
  const entries = nativeEntries(policy.config);
  const pending = new Map<string, { router: Router; decision: Decision; session: string; anchor: string | null; expires: number }>();
  const recordSelectorResult = (metadata: Readonly<Record<string, unknown>>) => {
    // Store only bounded accounting data, never classifier prompts or provider error payloads.
    const usage = metadata.usage as { input?: number; output?: number; totalTokens?: number; cost?: { total?: number } } | undefined;
    const finite = (v: unknown): number | undefined => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
    pi.appendEntry("virtual-models.selector-usage", {
      policyRevision: policy.revision,
      kind: metadata.kind,
      provider: metadata.provider,
      model: metadata.model,
      requestedThinking: metadata.requestedThinking,
      effectiveThinking: metadata.effectiveThinking,
      durationMs: finite(metadata.durationMs),
      stopReason: metadata.stopReason,
      input: finite(usage?.input), output: finite(usage?.output), totalTokens: finite(usage?.totalTokens),
      cost: finite(usage?.cost?.total),
    });
  };
  const definitions = createVirtualDefinitions(policy.config, recordSelectorResult, notice => pi.appendEntry(ROUTING_NOTICE_TYPE, notice), receipt => recordReceipt(receipt, "native"));
  for (const definition of definitions) pi.registerVirtualModel(definition);
  pi.on("session_shutdown", (event, ctx) => {
    pending.clear();
    if (event.reason !== "reload") return;
    // Pi retains virtual registrations across reloads unless explicitly removed.
    // Remove only this factory's entries, not an entire provider/namespace.
    for (const definition of definitions) {
      const registered = ctx.modelRegistry.find(definition.provider, definition.id);
      if (registered?.api === "pi-virtual" && registered.name === definition.name) {
        pi.unregisterVirtualModel(definition.provider, definition.id);
      }
    }
  });
  pi.on("session_start", (_event, ctx) => {
    pending.clear();
    for (const definition of definitions) {
      const registered = ctx.modelRegistry.find(definition.provider, definition.id);
      if (!registered || registered.api !== "pi-virtual" || registered.name !== definition.name) {
        throw new Error(`Virtual model registration missing or colliding: ${definition.provider}/${definition.id}. Choose unique namespaces and reload.`);
      }
    }
  });
  registerModelCommand(pi, {
    description: "Select a virtual policy, reselect on the next request, show status, or advisor / doctor / preview / explain. Automatic preview requires --allow-inference (may incur charges).",
    handler: async (args, ctx) => {
      const requested = args.trim();
      if (await advise(requested, ctx) || await diagnose(requested, ctx)) return;
      if (requested.split(/\s/, 1)[0] === "reselect") {
        if (requested !== "reselect") throw new RoutingError("INVALID_SELECTION", "Use /vmodel reselect without arguments");
        await ctx.waitForIdle();
        const entry = entries.find(e => e.provider === ctx.model?.provider && e.id === ctx.model?.id);
        if (ctx.model?.api !== "pi-virtual" || !entry || !Object.hasOwn(policy.automatic, entry.selection.split(":")[0]!)) {
          throw new RoutingError("INVALID_SELECTION", "Reselection requires a currently selected automatic virtual model; explicit and physical selections are unchanged");
        }
        pi.appendEntry(RESELECT_TYPE, { version: 1, selection: entry.selection });
        display(pi, ctx, "Automatic assignment reset. No inference was run; the next normal request selects again and may incur selector charges. Selection, context policy and recent dialogue are unchanged.");
        return;
      }
      if (!requested) {
        const usage = ctx.sessionManager.getBranch().filter(e => e.type === "custom" && e.customType === "virtual-models.selector-usage");
        let tokens = 0, cost = 0;
        for (const entry of usage) {
          if (entry.type !== "custom") continue;
          const data = entry.data as { totalTokens?: number; cost?: number } | undefined;
          tokens += data?.totalTokens ?? 0; cost += data?.cost ?? 0;
        }
        const records = ctx.sessionManager.getBranch().filter(e => e.type === "custom" && e.customType === DECISION_RECEIPT_TYPE);
        const receiptsFor = (preview: boolean) => records.filter(e => e.type === "custom" && ((e.data as { source?: string } | undefined)?.source === "preview") === preview).map(e => e.type === "custom" ? receiptFromEntry(e.data) : undefined).filter(r => r !== undefined);
        display(pi, ctx, { configPath, revision: policy.revision, autoModel: policy.autoModel, selected: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null,
          nativeRouting: { affinity: policy.config.nativeRouting?.affinity ?? "turn",
            capacity: policy.config.nativeRouting?.capacity ?? null,
            context: policy.config.nativeRouting?.context ? contextOptions(policy.config.nativeRouting.context) : { mode: "latest-user-prefix", maxMessageChars: 3000 },
            currentChoice: currentRouteState(ctx, entries, policy.config.nativeRouting?.affinity)?.assignment.choice ?? null,
            note: "Native routing only. Context is opt-in; reselect clears the assignment, not dialogue. Existing pins are revalidated before use." },
          selectorAttempts: summarizeSelectorAttempts(receiptsFor(false)),
          previewSelectorAttempts: summarizeSelectorAttempts(receiptsFor(true)),
          selectorUsage: { calls: usage.length, tokens, cost, note: "Reported selector usage. Native routing is separate from Pi execution totals; successful tool select calls also report tool usage. Timed-out calls may have unknown charges." },
          selections: entries.map(e => ({ choice: e.selection, native: `${e.provider}/${e.id}` })) });
        return;
      }
      const entry = entries.find(e => e.selection === requested);
      if (!entry) throw new RoutingError("INVALID_SELECTION", "Unknown policy selection. Run /virtual-model to list configured choices.");
      await ctx.waitForIdle();
      const model = ctx.modelRegistry.find(entry.provider, entry.id);
      if (!model || model.api !== "pi-virtual") throw new RoutingError("INVALID_SELECTION", "Virtual entry is missing; reload the extension");
      if (!await pi.setModel(model)) throw new RoutingError("INELIGIBLE", "Pi refused the selection");
      pi.setThinkingLevel("off");
      pi.appendEntry("virtual-models.selection", { selection: requested, id: randomUUID() });
      display(pi, ctx, `Selected ${requested}. Virtual effort is encoded in the model identity; physical thinking comes from policy.`);
    },
  });
  pi.registerTool({
    name: "virtual_models",
    label: "Virtual model policies",
    description: "List policies; resolve an explicit assignment; select automatically using the configured LLM/classifier; or prepare/answer a policy question as the coordinator. Does not change the parent model or launch work. Returned role instructions are guidance for the intended worker, not permission changes or instructions to switch the parent. Consumer restrictions and delegation authorization remain the caller's responsibility. Optional capacity declares an estimate of the intended execution input and output reserve, not this tool prompt; it does not set generation limits or run compaction.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("list"), Type.Literal("resolve"), Type.Literal("select"), Type.Literal("prepare"), Type.Literal("answer")]),
      selection: Type.Optional(Type.String({ maxLength: 128 })),
      state: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      allowedChoices: Type.Optional(Type.Array(Type.String({ maxLength: 128 }), { maxItems: 192 })),
      requiredInputs: Type.Optional(Type.Array(Type.Union([Type.Literal("text"), Type.Literal("image")]), { maxItems: 2 })),
      capacity: Type.Optional(Type.Object({
        mode: Type.Union([Type.Literal("require-estimated-fit"), Type.Literal("allow-compaction")]),
        inputTokens: Type.Union([Type.Integer({ minimum: 0, maximum: 1000000000 }), Type.Null()]),
        outputReserveTokens: Type.Integer({ minimum: 0, maximum: 1000000000 }),
        estimateSource: Type.Literal("caller"),
      }, { additionalProperties: false })),
      decisionId: Type.Optional(Type.String({ maxLength: 64 })),
      choice: Type.Optional(Type.String({ maxLength: 128 })),
    }, { additionalProperties: false }),
    executionMode: "sequential",
    renderResult(result, { expanded }, theme, context) {
      const notice = (result.details as { routingNotice?: RoutingNotice } | undefined)?.routingNotice;
      if (notice && !context.isError) return renderRoutingNotice(notice, expanded, theme);
      const text = result.content.filter(c => c.type === "text").map(c => c.text).join("\n");
      return new Text(expanded || context.isError ? text : `Virtual model policy result · ${keyHint("app.tools.expand", "details")}`, 0, 0);
    },
    async execute(_id, args, signal, _update, ctx) {
      const now = Date.now();
      for (const [id, item] of pending) if (item.expires <= now) pending.delete(id);
      let receipt: DecisionReceipt | undefined;
      const router = createRouter(policy.config, piInventory(ctx), { onReceipt: value => { receipt = value; recordReceipt(value, "tool"); } });
      const limits = { allowedChoices: args.allowedChoices, requiredInputs: args.requiredInputs, capacity: args.capacity };
      let result: unknown;
      let metadata: Readonly<Record<string, unknown>> | undefined;
      switch (args.action) {
        case "list": result = { configPath, revision: policy.revision, autoModel: policy.autoModel, automatic: policy.automatic, models: policy.config.models, questions: policy.config.questions }; break;
        case "resolve":
          if (!args.selection) throw new RoutingError("INVALID_SELECTION", "resolve requires selection");
          result = await router.resolve(args.selection, limits, signal); break;
        case "select": {
          const selection = args.selection ?? policy.autoModel;
          if (!selection) throw new RoutingError("INVALID_SELECTION", "Specify a namespace/auto selection when the global router is disabled");
          const selector = createSelector(ctx.modelRegistry, policy.automatic[selection.split(":")[0]!]?.selector, recordSelectorResult);
          const selected = await router.select(selection, args.state ?? {}, selector, limits, signal);
          result = selected.assignment;
          metadata = selected.metadata;
          break;
        }
        case "prepare": {
          if (pending.size >= 32) throw new RoutingError("INVALID_STATE", "32 coordinator decisions are pending; answer one or wait for its five-minute expiry. Advisor drafts are separate and do not expire.");
          const selection = args.selection ?? policy.autoModel;
          if (!selection) throw new RoutingError("INVALID_SELECTION", "Specify a namespace/auto selection when the global router is disabled");
          const decision = await router.prepare(selection, args.state ?? {}, limits, signal);
          pi.appendEntry("virtual-models.decision", { id: decision.id });
          pending.set(decision.id, { router, decision, session: ctx.sessionManager.getSessionId(), anchor: ctx.sessionManager.getLeafId(), expires: Date.now() + 300_000 });
          result = decision; break;
        }
        case "answer": {
          const item = args.decisionId ? pending.get(args.decisionId) : undefined;
          if (!item || item.session !== ctx.sessionManager.getSessionId() || (item.anchor && !ctx.sessionManager.getBranch().some(e => e.id === item.anchor))) {
            throw new RoutingError("STALE_DECISION", "Decision expired, was consumed, or belongs to another session/branch. Prepare again.");
          }
          pending.delete(item.decision.id);
          const assignment = await item.router.accept(item.decision, { answers: { route: { type: "choice", choice: args.choice } } }, signal);
          result = await router.revalidate(assignment, limits, signal); break;
        }
      }
      if (args.action === "resolve" || args.action === "select" || args.action === "answer") {
        const assignment = result as Assignment;
        const selector = selectorDiagnostics(metadata);
        const routingNotice: RoutingNotice = { version: 1, kind: "assignment", source: `tool:${args.action}`,
          strategy: args.action === "answer" ? "coordinator" : selector ? "automatic" : "explicit", ...assignment,
          effectiveThinking: clampThinkingLevel(physicalModel(ctx, assignment.target), assignment.target.thinking), ...(selector ? { selector } : {}), ...(receipt ? { receipt } : {}) };
        return { content: [{ type: "text", text: JSON.stringify(assignment, null, 2) }], details: { ...assignment, routingNotice }, ...(metadata?.usage ? { usage: metadata.usage as Usage } : {}) };
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
    },
  });
}
export default function virtualModels(pi: ExtensionAPI): void {
  const file = process.env.PI_VIRTUAL_MODELS_CONFIG ? resolve(process.env.PI_VIRTUAL_MODELS_CONFIG) : join(getAgentDir(), "virtual-models.json");
  let config: unknown;
  try { config = loadConfig(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (process.env.PI_VIRTUAL_MODELS_CONFIG) throw new RoutingError("INVALID_CONFIG", `Explicit policy file does not exist: ${file}`);
    const advise = registerAdvisor(pi, { file });
    registerModelCommand(pi, {
      description: "Set up virtual routing with /vmodel advisor or a manually created policy",
      handler: async (args, ctx) => {
        if (await advise(args.trim(), ctx)) return;
        display(pi, ctx, `No virtual model policy at ${file}. Use /vmodel advisor, or create it using examples/virtual-models.json, then /reload. Nothing was selected or created automatically.`);
      },
    });
    return;
  }
  registerVirtualModels(pi, config, file);
}
