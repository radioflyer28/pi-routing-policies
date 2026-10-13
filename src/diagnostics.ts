import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { createRouter, parseSelection, RoutingError } from "./core/index.ts";
import type { DecisionReceipt, Policy, SelectorConfig } from "./core/index.ts";
import { DECISION_RECEIPT_TYPE, receiptFromEntry } from "./decision-notice.ts";
import { nativeEntries, piInventory } from "./pi-adapter.ts";
import { createSelector } from "./selectors.ts";

export const DIAGNOSTIC_TYPE = "virtual-models.diagnostic";
const clean = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
const usage = "Use doctor [selection], explain [latest|receipt-id], or preview [--allow-inference] selection -- task (1–3000 characters). Automatic preview may incur selector charges; it never dispatches execution.";
type Command = { kind: "doctor"; selection?: string } | { kind: "explain"; id: string } | { kind: "preview"; selection: string; task: string; allowInference: boolean };
export function parseDiagnostic(args: string): Command | undefined {
  const name = args.trim().split(/\s/, 1)[0];
  if (!["doctor", "explain", "preview"].includes(name!)) return undefined;
  const invalid = () => { throw new RoutingError("INVALID_SELECTION", usage); };
  if (args.length > 3300) return invalid();
  const parts = args.trim().split(/\s+/);
  if (name === "doctor" || name === "explain") {
    if (parts.length > 2 || (parts[1]?.length ?? 0) > 128) return invalid();
    return name === "doctor" ? { kind: name, selection: parts[1] } : { kind: name, id: parts[1] ?? "latest" };
  }
  const match = /^preview\s+(?:(--allow-inference)\s+)?(\S+)\s+--\s+([\s\S]+)$/.exec(args.trim());
  if (!match || match[2]!.length > 128 || !match[3]!.trim() || match[3]!.length > 3000) return invalid();
  return { kind: "preview", selection: match[2]!, task: match[3]!, allowInference: !!match[1] };
}
function selectorHealth(ctx: ExtensionCommandContext, config?: SelectorConfig) {
  if (!config) return { status: "selector_unconfigured" };
  const model = config.kind === "classifier" ? ctx.modelRegistry.findOfType("classifier", config.provider, config.model) : ctx.modelRegistry.find(config.provider, config.model);
  const status = !model ? "model_missing" : model.api === "pi-virtual" ? "not_physical" : !model.input.includes("text") ? "input_unsupported" : !ctx.modelRegistry.getProviderAuthStatus(config.provider).configured ? "auth_missing" : "configured";
  return { kind: config.kind, provider: config.provider, model: config.model, status };
}
/** Command-only diagnostics. No tool, context messages, model changes or coordinator handles. */
export function registerDiagnostics(pi: ExtensionAPI, policy: Policy) {
  const entries = nativeEntries(policy.config);
  const controllers = new Set<AbortController>();
  pi.on("session_shutdown", () => { for (const controller of controllers) controller.abort(); controllers.clear(); });
  pi.registerEntryRenderer<{ version: 1; kind: string; report: unknown }>(DIAGNOSTIC_TYPE, (entry, { expanded }, theme) => {
    const data = entry.data;
    if (data?.version !== 1 || typeof data.kind !== "string" || data.report === undefined) return undefined;
    const detail = expanded ? JSON.stringify(data.report, null, 2).replace(/[\u007f-\u009f]/g, "") : "";
    const body = expanded ? detail.slice(0, 32768) + (detail.length > 32768 ? "\nDisplay truncated; full report remains in the session entry." : "") : `Virtual model ${clean(data.kind)} · diagnostic only (expand for details)`;
    return new Text(theme.fg("dim", body), 0, 0);
  });
  const publish = (ctx: ExtensionCommandContext, kind: string, report: unknown) => {
    if (Buffer.byteLength(JSON.stringify(report), "utf8") > 524288) throw new RoutingError("INVALID_STATE", "Diagnostic report exceeds 512 KiB");
    pi.appendEntry(DIAGNOSTIC_TYPE, { version: 1, kind, report });
    if (ctx.hasUI) ctx.ui.notify(`Virtual model ${kind}: diagnostic recorded; expand the entry for details. No execution selection changed.`, "info");
  };
  return async (args: string, ctx: ExtensionCommandContext): Promise<boolean> => {
    const command = parseDiagnostic(args);
    if (!command) return false;
    if (command.kind === "explain") {
      const records = ctx.sessionManager.getBranch().flatMap(entry => {
        if (entry.type !== "custom" || entry.customType !== DECISION_RECEIPT_TYPE) return [];
        const receipt = receiptFromEntry(entry.data);
        return receipt ? [{ receipt, source: (entry.data as { source?: string }).source }] : [];
      });
      const record = command.id === "latest" ? records.at(-1) : records.findLast(r => r.receipt.id === command.id);
      if (!record) throw new RoutingError("STALE_DECISION", "No matching decision receipt on the active branch. Use the exact receipt ID, not a decision/authority ID.");
      publish(ctx, "explain", { source: record.source, receipt: record.receipt, currentPolicyRevision: policy.revision, historicalPolicy: record.receipt.policyRevision !== policy.revision, note: "Original recorded checks only; no current eligibility check or inference. An assignment is not proof of dispatch or completion." });
      return true;
    }
    if (command.selection && !entries.some(e => e.selection === command.selection)) throw new RoutingError("INVALID_SELECTION", "Unknown policy selection. Run /vmodel to list configured choices.");
    if (command.kind === "doctor") {
      const inventory = piInventory(ctx);
      let receipt: DecisionReceipt | undefined;
      if (command.selection) {
        const router = createRouter(policy.config, inventory, { onReceipt: value => { receipt = value; } });
        try {
          if (parseSelection(command.selection, Object.keys(policy.automatic)).mode === "auto") await router.prepare(command.selection, {}, { requiredInputs: ["text"] });
          else await router.resolve(command.selection, { requiredInputs: ["text"] });
        } catch (error) { if (!(error instanceof RoutingError)) throw error; }
      }
      const candidates = command.selection ? receipt?.candidates : await Promise.all(Object.entries(policy.variants).map(async ([choice, target]) => ({ choice, ...await inventory(target, ["text"]) })));
      const automatic = Object.entries(policy.automatic).filter(([selection]) => !command.selection || command.selection.split(":")[0] === selection).map(([selection, route]) => ({ selection, ...selectorHealth(ctx, route.selector) }));
      const registrations = entries.filter(e => !command.selection || e.selection === command.selection).map(e => {
        const model = ctx.modelRegistry.find(e.provider, e.id);
        return { selection: e.selection, status: !model ? "missing" : model.api !== "pi-virtual" || model.name !== `${e.selection} (virtual policy)` ? "collision" : "registered" };
      });
      publish(ctx, "doctor", { policyRevision: policy.revision, selection: command.selection ?? null, candidates, automatic, registrations, ...(receipt ? { outcome: receipt.outcome, errorCode: receipt.errorCode } : {}),
        nativeCapacity: policy.config.nativeRouting?.capacity ?? null,
        direct: policy.config.direct ? await inventory(policy.config.direct, ["text"]) : { configured: false },
        note: "No inference or network probe. Checks configured auth presence, not credential validity or endpoint reachability. Candidate checks assume text input; image/context capacity and future availability are not certified." });
      return true;
    }
    const automatic = parseSelection(command.selection, Object.keys(policy.automatic)).mode === "auto";
    if (automatic && !command.allowInference) throw new RoutingError("INVALID_SELECTION", "Automatic preview may incur selector charges. Add --allow-inference before the selection to consent. No inference was run.");
    if (controllers.size) throw new RoutingError("INVALID_STATE", "A preview is already running; wait for it to finish.");
    const controller = new AbortController();
    controllers.add(controller);
    const signal = ctx.signal ? AbortSignal.any([controller.signal, ctx.signal]) : controller.signal;
    const session = ctx.sessionManager.getSessionId();
    const anchor = ctx.sessionManager.getLeafId();
    let receipt: DecisionReceipt | undefined;
    const router = createRouter(policy.config, piInventory(ctx), { onReceipt: value => { receipt = value; } });
    try {
      try {
        await router.select(command.selection, { task: command.task, taskTruncated: false, hasImages: false }, createSelector(ctx.modelRegistry, policy.automatic[command.selection.split(":")[0]!]?.selector), { requiredInputs: ["text"] }, signal);
      } catch (error) { if (!receipt) throw error; }
      // Do not attach an old-session/abandoned-branch result to the newly active branch.
      if (controller.signal.aborted || session !== ctx.sessionManager.getSessionId() || (anchor && !ctx.sessionManager.getBranch().some(e => e.id === anchor))) return true;
      if (receipt) {
        pi.appendEntry(DECISION_RECEIPT_TYPE, { source: "preview", receipt });
        publish(ctx, "preview", { source: "preview", receipt, note: "Proposal only; no execution dispatch, model/thinking change, task state, guidance or pending coordinator handle was applied. Text-only task, no history/files/images uploaded. Execution capacity is not assessed from this diagnostic task. Reported usage is selector-only; unreported charges remain unknown." });
      }
    } finally { controllers.delete(controller); }
    return true;
  };
}
