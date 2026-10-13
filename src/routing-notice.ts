import { keyHint } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import type { CapacityAssessment, CapacityRequirement, DecisionReceipt, Target, Thinking } from "./core/index.ts";
import { capacityDetails, receiptDetails } from "./decision-notice.ts";
import type { ContextSummary } from "./native-context.ts";

export const ROUTING_NOTICE_TYPE = "virtual-models.route";
export interface SelectorDiagnostics {
  kind: "llm" | "classifier";
  provider: string;
  model: string;
  requestedThinking?: string;
  effectiveThinking?: string;
  durationMs?: number;
  totalTokens?: number;
  cost?: number;
  confidence?: number;
}
export interface RoutingNotice {
  version: 1;
  /** A tool resolves an assignment; it does not imply that execution happened. */
  kind: "route" | "assignment";
  source: string;
  strategy: "automatic" | "explicit" | "reused" | "direct" | "coordinator";
  selection: string;
  choice?: string;
  target: Target;
  effectiveThinking: Thinking;
  decisionId?: string;
  policyRevision: string;
  selector?: SelectorDiagnostics;
  instructions?: string;
  receipt?: DecisionReceipt;
  contextSummary?: ContextSummary;
  directCapacity?: { requirement: CapacityRequirement; assessment: CapacityAssessment };
}
const finite = (v: unknown): number | undefined => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
function clean(value: string): string { return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "").replace(/\t/g, "  "); }
export function selectorDiagnostics(metadata?: Readonly<Record<string, unknown>>): SelectorDiagnostics | undefined {
  if (!metadata || (metadata.kind !== "llm" && metadata.kind !== "classifier") || typeof metadata.provider !== "string" || typeof metadata.model !== "string") return undefined;
  const usage = metadata.usage as { totalTokens?: number; cost?: { total?: number } } | undefined;
  return {
    kind: metadata.kind, provider: clean(metadata.provider).slice(0, 128), model: clean(metadata.model).slice(0, 512),
    ...(typeof metadata.requestedThinking === "string" ? { requestedThinking: clean(metadata.requestedThinking).slice(0, 16) } : {}),
    ...(typeof metadata.effectiveThinking === "string" ? { effectiveThinking: clean(metadata.effectiveThinking).slice(0, 16) } : {}),
    ...(finite(metadata.durationMs) !== undefined ? { durationMs: finite(metadata.durationMs) } : {}),
    ...(finite(usage?.totalTokens) !== undefined ? { totalTokens: finite(usage?.totalTokens) } : {}),
    ...(finite(usage?.cost?.total) !== undefined ? { cost: finite(usage?.cost?.total) } : {}),
    ...(finite(metadata.confidence) !== undefined && Number(metadata.confidence) <= 1 ? { confidence: Number(metadata.confidence) } : {}),
  };
}
/** Uses Pi's expansion keybinding (Ctrl-O by default), never installs a competing shortcut. */
export function renderRoutingNotice(data: RoutingNotice, expanded: boolean, theme: Theme): Component {
  return {
    render(width) {
      const label = data.kind === "assignment" ? "Assignment" : data.source === "direct" ? "Routing (direct)" : "Routing";
      const summary = `${label}: ${data.selection} → ${data.target.provider}/${data.target.model} (thinking: ${data.effectiveThinking})`;
      const hint = expanded ? "" : ` · ${keyHint("app.tools.expand", "details")}`;
      const lines = [truncateToWidth(theme.fg("accent", clean(summary)) + theme.fg("dim", hint), width)];
      if (!expanded) return lines;
      const details = [
        `Source: ${data.source}; ${data.strategy}${data.kind === "assignment" ? " (resolved only; not executed or applied to the parent)" : " (chosen for dispatch; not proof of completed inference)"}`,
        ...(data.choice ? [`Policy variant: ${data.choice}`] : []),
        `Execution thinking: requested ${data.target.thinking}; effective ${data.effectiveThinking}`,
      ];
      if (data.selector) {
        const s = data.selector;
        details.push(`Selector: ${s.kind} ${s.provider}/${s.model}`);
        if (s.requestedThinking) details.push(`Selector thinking: requested ${s.requestedThinking}; effective ${s.effectiveThinking ?? "unknown"}`);
        details.push(`Selector latency: ${s.durationMs ?? "unknown"} ms; reported tokens: ${s.totalTokens ?? "unknown"}; reported cost: ${s.cost === undefined ? "unknown" : `$${s.cost.toFixed(6)}`}`);
        if (s.confidence !== undefined) details.push(`Classifier confidence (diagnostic only): ${s.confidence}`);
      } else details.push(data.strategy === "coordinator" ? "Selector: coordinating LLM supplied the choice" : "Selector: not invoked for this interaction");
      if (data.contextSummary) {
        const c = data.contextSummary;
        details.push(`Selector context: task ${c.taskChars} chars${c.taskTruncated ? " (truncated)" : ""}; history ${c.historyMessages} messages / ${c.historyChars} chars${c.historyTruncated ? " (clipped or omitted)" : ""}; state ${c.stateBytes} bytes`);
      }
      if (data.directCapacity) details.push(...capacityDetails(data.directCapacity.requirement, data.directCapacity.assessment));
      if (data.receipt) details.push(...receiptDetails(data.receipt));
      if (data.instructions) details.push(`Role guidance (not permissions):\n${data.instructions}`);
      if (data.decisionId) details.push(`Decision: ${data.decisionId}`);
      details.push(`Policy revision: ${data.policyRevision}`);
      return [...lines, ...new Text(theme.fg("dim", clean(details.join("\n"))), 0, 0).render(width)];
    },
    invalidate() {},
  };
}
export function registerRoutingRenderer(pi: ExtensionAPI): void {
  pi.registerEntryRenderer<RoutingNotice>(ROUTING_NOTICE_TYPE, (entry, options, theme) => {
    const data = entry.data;
    if (!data || data.version !== 1 || !data.target) return new Text("Routing details unavailable", 0, 0);
    return renderRoutingNotice(data, options.expanded, theme);
  });
}
