import { keyHint } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import type { CapacityAssessment, CapacityRequirement, DecisionReceipt } from "./core/index.ts";

export const DECISION_RECEIPT_TYPE = "virtual-models.decision-receipt";
export interface DecisionEntry { source: "native" | "tool" | "preview"; receipt: DecisionReceipt }
const clean = (value: unknown): string => String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, 1024);
const finite = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
export function receiptFromEntry(value: unknown): DecisionReceipt | undefined {
  const receipt = (value as Partial<DecisionEntry> | undefined)?.receipt;
  return receipt?.version === 1 && Array.isArray(receipt.candidates) && receipt.candidates.length <= 192 && receipt.candidates.every(c => c && typeof c.choice === "string" && typeof c.eligible === "boolean") && typeof receipt.selector?.invoked === "boolean" && receipt.selector.usage ? receipt : undefined;
}
export function capacityDetails(requirement: CapacityRequirement, assessment?: CapacityAssessment): string[] {
  return [
    `Capacity: ${requirement.mode}; execution input ${requirement.inputTokens ?? "unknown"} tokens (${requirement.estimateSource}); output reserve ${requirement.outputReserveTokens}`,
    ...(assessment ? [`Capacity result: ${assessment.status}; context window ${assessment.contextWindow ?? "unknown"}; output limit ${assessment.maxOutputTokens ?? "unknown"}`] : []),
    "Capacity is estimated admission only; no generation limits changed. Permitted compaction is not proof it is enabled or will succeed.",
  ];
}
/** Bounded text only; detailed records remain available in the custom entry. */
export function receiptDetails(receipt: DecisionReceipt): string[] {
  const excluded = receipt.candidates.filter(c => !c.eligible);
  const selector = receipt.selector;
  return [
    `Decision record: ${receipt.id}; ${receipt.operation} → ${receipt.outcome}${receipt.errorCode ? ` (${receipt.errorCode})` : ""}`,
    `Candidates: ${receipt.candidates.length - excluded.length} eligible; ${excluded.length} excluded (latest check per choice)`,
    ...excluded.slice(0, 12).map(c => `Excluded: ${c.choice} — ${c.reason ?? "inventory_rejected"} (${c.stage})`),
    ...(excluded.length > 12 ? [`${excluded.length - 12} additional exclusions in the decision record`] : []),
    ...(receipt.capacity ? [
      ...capacityDetails(receipt.capacity),
      ...receipt.candidates.filter(c => c.capacity).slice(0, 12).map(c => `Capacity ${c.choice}: ${c.capacity!.status}; window ${c.capacity!.contextWindow ?? "unknown"}; output ${c.capacity!.maxOutputTokens ?? "unknown"}; ${c.eligible ? "admitted" : "excluded"}`),
    ] : []),
    `Selector invocation: ${selector.invoked ? selector.outcome : "not invoked"}; not proof of network execution`,
    ...(selector.identity ? [`Selector identity: ${selector.identity.kind}${selector.identity.provider ? ` ${selector.identity.provider}/${selector.identity.model ?? "unknown"}` : ""}`] : []),
    ...(selector.invoked ? [`Reported selector tokens: ${finite(selector.usage.totalTokens) ?? "unknown"}; cost: ${finite(selector.usage.cost) === undefined ? "unknown" : `$${selector.usage.cost!.toFixed(6)}`}`] : []),
    `Decision elapsed: ${Math.round(finite(receipt.durationMs) ?? 0)} ms; policy: ${receipt.policyRevision}`,
    "Record describes resolution, not completed inference or task success.",
  ].map(clean);
}
export function renderDecisionFailure(receipt: DecisionReceipt, expanded: boolean, theme: Theme): Component {
  return {
    render(width) {
      const summary = clean(`Routing ${receipt.outcome}: ${receipt.selection ?? "unrecognized selection"} · ${receipt.errorCode ?? receipt.outcome}`);
      const hint = expanded ? "" : ` · ${keyHint("app.tools.expand", "details")}`;
      const lines = [truncateToWidth(theme.fg("warning", summary) + theme.fg("dim", hint), width)];
      return expanded ? [...lines, ...new Text(theme.fg("dim", receiptDetails(receipt).join("\n")), 0, 0).render(width)] : lines;
    },
    invalidate() {},
  };
}
export function registerDecisionRenderer(pi: ExtensionAPI): void {
  pi.registerEntryRenderer<DecisionEntry>(DECISION_RECEIPT_TYPE, (entry, { expanded }, theme) => {
    const receipt = receiptFromEntry(entry.data);
    // Successful routes already have their compact native notice or tool-result renderer.
    if (!receipt || entry.data?.source === "preview" || receipt.outcome === "assigned" || receipt.outcome === "prepared") return undefined;
    return renderDecisionFailure(receipt, expanded, theme);
  });
}
/** Separate from legacy usage entries: never add this again to generation/tool billing totals. */
export function summarizeSelectorAttempts(receipts: readonly DecisionReceipt[]) {
  const attempts = receipts.filter(receipt => receipt.selector.invoked);
  return {
    invocations: attempts.length,
    returned: attempts.filter(r => r.selector.outcome === "returned").length,
    timedOut: attempts.filter(r => r.selector.outcome === "timeout").length,
    aborted: attempts.filter(r => r.outcome === "aborted").length,
    failedDecisions: attempts.filter(r => r.outcome !== "assigned").length,
    reportedTokens: attempts.reduce((sum, r) => sum + (finite(r.selector.usage.totalTokens) ?? 0), 0),
    reportedCost: attempts.reduce((sum, r) => sum + (finite(r.selector.usage.cost) ?? 0), 0),
    unknownTokenInvocations: attempts.filter(r => finite(r.selector.usage.totalTokens) === undefined).length,
    unknownCostInvocations: attempts.filter(r => finite(r.selector.usage.cost) === undefined).length,
    note: "Recorded selector method invocations, not HTTP attempts. Reported totals are partial when unknown counts are nonzero; do not add them again to usage/tool totals. Older sessions may have usage entries without receipts.",
  };
}
