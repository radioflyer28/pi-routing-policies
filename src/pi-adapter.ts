import { clampThinkingLevel } from "@earendil-works/pi-ai";
import type { Api, Message, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext, ExtensionVirtualModel, SessionEntry } from "@earendil-works/pi-coding-agent";
import { createSelector } from "./selectors.ts";
import { assessCapacity, createRouter, EFFORTS, parsePolicy, parseSelection, RoutingError } from "./core/index.ts";
import type { Assignment, DecisionReceipt, Input, Inventory, PolicyConfig, Target } from "./core/index.ts";
import { createReceipt } from "./core/receipt.ts";
import { observedCapacity } from "./core/capacity.ts";
import { selectorDiagnostics } from "./routing-notice.ts";
import type { RoutingNotice } from "./routing-notice.ts";
import { buildNativeContext, projectedDialogue } from "./native-context.ts";
import { nativeCapacity } from "./native-capacity.ts";
import type { ContextSummary } from "./native-context.ts";

export const RESELECT_TYPE = "virtual-models.reselect";

export interface RouteState { version: 1; epoch: string; taskId: string; assignment: Assignment }
export interface NativeEntry { provider: string; id: string; selection: string }
export function nativeEntries(config: unknown): NativeEntry[] {
  const policy = parsePolicy(config);
  const entries: NativeEntry[] = [];
  for (const selection of Object.keys(policy.automatic)) {
    const [provider, id] = selection.split("/") as [string, string];
    entries.push({ provider, id, selection });
    for (const effort of EFFORTS) entries.push({ provider, id: `${id}/${effort}`, selection: `${selection}:${effort}` });
  }
  for (const [role, definition] of Object.entries(policy.config.models)) {
    const [provider, id] = role.split("/") as [string, string];
    entries.push({ provider, id, selection: role });
    for (const effort of EFFORTS) if (definition.efforts[effort]) {
      entries.push({ provider, id: `${id}/${effort}`, selection: `${role}:${effort}` });
    }
  }
  return entries;
}
export function requiredInputs(messages: readonly Message[]): Input[] {
  const images = messages.some(m => Array.isArray(m.content) && m.content.some(block => block.type === "image"));
  return images ? ["text", "image"] : ["text"];
}
export function physicalModel(ctx: Pick<ExtensionContext, "modelRegistry">, target: Target): Model<Api> {
  const model = ctx.modelRegistry.find(target.provider, target.model);
  if (!model || model.api === "pi-virtual" || !ctx.modelRegistry.hasConfiguredAuth(model)) {
    throw new RoutingError("INELIGIBLE", `Physical target unavailable or unauthenticated: ${target.provider}/${target.model}`);
  }
  return model;
}
/** Pi scopedModels controls selection, not a physical authorization policy. Consumers inject stricter inventory rules. */
export function piInventory(ctx: Pick<ExtensionContext, "modelRegistry">): Inventory {
  return (target, inputs) => {
    const model = ctx.modelRegistry.find(target.provider, target.model);
    if (!model) return { eligible: false, code: "model_missing" };
    if (model.api === "pi-virtual") return { eligible: false, code: "not_physical" };
    if (!ctx.modelRegistry.hasConfiguredAuth(model)) return { eligible: false, code: "auth_missing" };
    return inputs.every(input => model.input.includes(input)) ? { eligible: true, capacity: observedCapacity({ contextWindow: model.contextWindow, maxOutputTokens: model.maxTokens }) } : { eligible: false, code: "input_unsupported" };
  };
}
function epoch(branch: readonly SessionEntry[]): string {
  const entry = branch.findLast(e => e.type === "model_change" || (e.type === "custom" && (e.customType === "virtual-models.selection" || e.customType === RESELECT_TYPE)));
  return entry?.id ?? "initial";
}
function storedState(branch: readonly SessionEntry[], entry: NativeEntry): RouteState | undefined {
  for (let i = branch.length - 1; i >= 0; i--) {
    const item = branch[i]!;
    if (item.type !== "custom" || item.customType !== "pi.virtual-model-state") continue;
    const data = item.data as { provider?: string; modelId?: string; state?: RouteState } | undefined;
    if (data?.provider === entry.provider && data.modelId === entry.id) return data.state;
  }
  return undefined;
}
/** Reads only the current native selection's current task state, never a tool's independent assignment. */
export function currentRouteState(ctx: ExtensionContext, entries: readonly NativeEntry[], affinity: "turn" | "session" = "turn"): RouteState | undefined {
  if (ctx.model?.api !== "pi-virtual") return undefined;
  const entry = entries.find(e => e.provider === ctx.model?.provider && e.id === ctx.model?.id);
  if (!entry) return undefined;
  const branch = ctx.sessionManager.getBranch();
  const state = storedState(branch, entry);
  const taskId = branch.findLast(e => e.type === "message" && e.message.role === "user")?.id ?? "no-user";
  return state?.version === 1 && state.epoch === epoch(branch) && (affinity === "session" || state.taskId === taskId) && state.assignment?.selection === entry.selection ? state : undefined;
}
export function createVirtualDefinitions(
  config: PolicyConfig,
  onSelectorResult?: (metadata: Readonly<Record<string, unknown>>, ctx: ExtensionContext) => void,
  onRoute?: (notice: RoutingNotice, ctx: ExtensionContext) => void,
  onReceipt?: (receipt: DecisionReceipt, ctx: ExtensionContext) => void,
): ExtensionVirtualModel<RouteState>[] {
  const policy = parsePolicy(config);
  return nativeEntries(policy.config).map(entry => ({
    provider: entry.provider,
    id: entry.id,
    name: `${entry.selection} (virtual policy)`,
    // Effort is encoded in native identity, never guessed from Pi's default thinking level.
    thinkingLevels: ["off"],
    input: ["text", "image"],
    async route(request, ctx) {
      const branch = ctx.sessionManager.getBranch();
      const currentEpoch = epoch(branch);
      const taskId = branch.findLast(e => e.type === "message" && e.message.role === "user")?.id ?? "no-user";
      const session = ctx.sessionManager.getSessionId();
      const anchor = ctx.sessionManager.getLeafId();
      const isCurrent = () => {
        const active = ctx.sessionManager.getBranch();
        return session === ctx.sessionManager.getSessionId() && epoch(active) === currentEpoch &&
          (active.findLast(e => e.type === "message" && e.message.role === "user")?.id ?? "no-user") === taskId &&
          (!anchor || active.some(e => e.id === anchor));
      };
      let receipt: DecisionReceipt | undefined;
      const observe = (value: DecisionReceipt) => { receipt = value; if (isCurrent()) onReceipt?.(value, ctx); };
      const routeFailure = createReceipt(policy, "route", entry.selection, { onReceipt: observe });
      try {
        const router = createRouter(policy.config, piInventory(ctx), { onReceipt: observe });
        const parsed = parseSelection(entry.selection, Object.keys(policy.automatic));
        const sessionAffinity = parsed.mode === "auto" && policy.config.nativeRouting?.affinity === "session";
        const inputs = requiredInputs(request.messages);
        const capacity = nativeCapacity(policy.config, request.messages, request.reason === "direct");
        const limits = { requiredInputs: inputs, ...(capacity ? { capacity } : {}) };
        routeFailure.capacity(capacity);
        const prior = request.reason === "direct" ? storedState(branch, entry) : request.state;
        let assignment: Assignment;
        let metadata: Readonly<Record<string, unknown>> | undefined;
        let contextSummary: ContextSummary | undefined;
        let strategy: RoutingNotice["strategy"] = parsed.mode === "auto" ? "automatic" : "explicit";
        if (prior?.version === 1 && prior.epoch === currentEpoch && (sessionAffinity || prior.taskId === taskId) && prior.assignment?.selection === entry.selection && (sessionAffinity || request.reason !== "user")) {
          assignment = await router.revalidate(prior.assignment, limits, request.signal);
          strategy = "reused";
        } else if (parsed.mode === "explicit") {
          assignment = await router.resolve(entry.selection, limits, request.signal);
        } else if (request.reason === "direct") {
          const target = policy.config.direct;
          if (!target) throw new RoutingError("NO_ASSIGNMENT", "No current automatic assignment for direct request; configure direct or select an explicit policy");
          const inventory = await piInventory(ctx)(target, inputs, request.signal);
          if (!inventory.eligible) throw new RoutingError("INELIGIBLE", "Direct target is ineligible");
          const assessment = capacity ? assessCapacity(capacity, inventory.capacity) : undefined;
          if (assessment) {
            routeFailure.candidate({ choice: "direct", eligible: assessment.eligible, stage: "recheck", capacity: assessment.assessment,
              ...(assessment.code ? { reason: assessment.code } : {}) });
            if (!assessment.eligible) throw new RoutingError("INELIGIBLE", `Direct target failed capacity admission: ${assessment.code}`);
          }
          if (!isCurrent()) throw new RoutingError("STALE_DECISION", "Session, branch or selection changed during routing");
          const model = physicalModel(ctx, target);
          onRoute?.({ version: 1, kind: "route", source: "direct", strategy: "direct", selection: entry.selection, target,
            effectiveThinking: clampThinkingLevel(model, target.thinking), policyRevision: policy.revision,
            ...(capacity && assessment ? { directCapacity: { requirement: capacity, assessment: assessment.assessment } } : {}) }, ctx);
          return { model, thinkingLevel: target.thinking };
        } else {
          const selector = createSelector(ctx.modelRegistry, policy.automatic[entry.selection.split(":")[0]!]?.selector, metadata => { if (isCurrent()) onSelectorResult?.(metadata, ctx); });
          const context = buildNativeContext(projectedDialogue(request.messages, ctx.sessionManager.buildSessionProjection().messages), inputs.includes("image"), policy.config.nativeRouting?.context);
          contextSummary = context.summary;
          ({ assignment, metadata } = await router.select(entry.selection, { ...context.state }, selector, limits, request.signal));
        }
        if (!isCurrent()) throw new RoutingError("STALE_DECISION", "Session, branch or selection changed during routing");
        const model = physicalModel(ctx, assignment.target);
        if (request.reason === "user" || request.reason === "direct" || strategy !== "reused") {
          const selector = selectorDiagnostics(metadata);
          onRoute?.({ version: 1, kind: "route", source: request.reason, strategy, ...assignment,
            effectiveThinking: clampThinkingLevel(model, assignment.target.thinking), ...(selector ? { selector } : {}), ...(receipt ? { receipt } : {}), ...(contextSummary ? { contextSummary } : {}) }, ctx);
        }
        if (request.reason === "direct") return { model, thinkingLevel: assignment.target.thinking };
        const state: RouteState = prior?.assignment?.decisionId === assignment.decisionId && prior.epoch === currentEpoch && prior.taskId === taskId && JSON.stringify(prior.assignment.capacity) === JSON.stringify(assignment.capacity)
          ? prior : { version: 1, epoch: currentEpoch, taskId, assignment };
        return { model, thinkingLevel: assignment.target.thinking, state };
      } catch (error) {
        // A core failure already has a receipt. Pre-core and post-resolution dispatch failures need their own route record.
        if (!receipt || receipt.outcome === "assigned" || receipt.outcome === "prepared") {
          if (receipt?.decisionId) routeFailure.prepared(receipt.decisionId);
          routeFailure.finish({ error });
        }
        throw error;
      }
    },
  }));
}
