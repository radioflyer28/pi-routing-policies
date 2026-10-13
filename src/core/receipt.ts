import { randomUUID } from "node:crypto";
import { freeze, parseSelection } from "./policy.ts";
import { RoutingError } from "./types.ts";
import type { Assignment, CandidateAssessment, CapacityRequirement, DecisionReceipt, ErrorCode, InventoryExclusionCode, Policy, RouterOptions, Selector, SelectorObservation } from "./types.ts";

const INVENTORY_CODES = new Set<InventoryExclusionCode>(["model_missing", "not_physical", "auth_missing", "input_unsupported", "restricted", "inventory_rejected"]);
const ERROR_CODES = new Set<ErrorCode>(["INVALID_CONFIG", "INVALID_SELECTION", "INELIGIBLE", "NO_CANDIDATES", "INVALID_STATE", "INVALID_ANSWER", "STALE_DECISION", "ABSTAINED", "ABORTED", "SELECTOR_UNAVAILABLE", "SELECTOR_ERROR", "SELECTOR_TIMEOUT", "NO_ASSIGNMENT"]);
const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
export function inventoryCode(value: unknown): InventoryExclusionCode {
  return INVENTORY_CODES.has(value as InventoryExclusionCode) ? value as InventoryExclusionCode : "inventory_rejected";
}
/** Only reported numeric usage survives. No raw provider fields, prose or task state. */
export function selectorObservation(metadata: unknown): SelectorObservation {
  try {
    const usage = (metadata as { usage?: { totalTokens?: unknown; cost?: { total?: unknown } } } | undefined)?.usage;
    return Object.freeze({ totalTokens: finite(usage?.totalTokens), cost: finite(usage?.cost?.total) });
  } catch { return Object.freeze({ totalTokens: null, cost: null }); }
}
/** Keep known usage when a completed provider response subsequently fails validation. */
export function observedSelectorResult<T>(metadata: unknown, finish: () => T): T {
  try { return finish(); }
  catch (error) {
    if (error instanceof RoutingError) throw new RoutingError(error.code, error.message, selectorObservation(metadata));
    throw error;
  }
}
function safeSelection(policy: Policy, value: unknown): string | null {
  if (typeof value !== "string" || value.length > 128) return null;
  try {
    const parsed = parseSelection(value, Object.keys(policy.automatic));
    return parsed.mode === "auto" || Object.hasOwn(policy.config.models, parsed.role) ? value : null;
  } catch { return null; }
}
function identity(selector: Selector): Selector["identity"] {
  try {
    const value = selector.identity;
    if (!value) return { kind: "custom" };
    const text = (v: unknown, max: number): string | undefined => typeof v === "string" && v.length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(v) ? v : undefined;
    return { kind: value.kind === "classifier" || value.kind === "llm" ? value.kind : "custom",
      ...(text(value.provider, 128) !== undefined ? { provider: value.provider } : {}),
      ...(text(value.model, 512) !== undefined ? { model: value.model } : {}) };
  } catch { return { kind: "custom" }; }
}

/** Per-operation state: never shared between concurrent decisions, and never contains the task. */
export function createReceipt(policy: Policy, operation: DecisionReceipt["operation"], selection: unknown, options: RouterOptions) {
  const id = randomUUID(), startedAt = Date.now(), start = performance.now();
  const candidates = new Map<string, CandidateAssessment>();
  let decisionId: string | undefined;
  let capacity: CapacityRequirement | undefined;
  let assigned: DecisionReceipt["assignment"];
  let invoked = false, returned = false, selectorStart = 0, selectorDuration: number | undefined;
  let selectorIdentity: Selector["identity"];
  let usage: SelectorObservation = { totalTokens: null, cost: null };
  return {
    capacity(value?: CapacityRequirement) { capacity = value; },
    candidate(value: CandidateAssessment) { candidates.set(value.choice, { ...value }); },
    candidates(values: readonly CandidateAssessment[]) { for (const value of values) candidates.set(value.choice, { ...value }); },
    assessments(): readonly CandidateAssessment[] { return freeze([...candidates.values()].map(value => ({ ...value }))); },
    prepared(value: string) { decisionId = value; },
    assigned(value: Assignment) {
      if (/^[a-f0-9-]{36}$/i.test(value.decisionId)) decisionId = value.decisionId;
      assigned = { choice: value.choice, target: value.target };
    },
    invoking(selector: Selector) { invoked = true; selectorStart = performance.now(); selectorIdentity = identity(selector); },
    returned(metadata: unknown) { returned = true; selectorDuration = Math.max(0, performance.now() - selectorStart); usage = selectorObservation(metadata); },
    finish(failure?: { error: unknown }) {
      // Diagnostics must never change a decision/error, even when a consumer's observer throws.
      try {
        const error = failure?.error;
        const code = error instanceof RoutingError && ERROR_CODES.has(error.code) ? error.code : failure ? "INTERNAL_ERROR" : undefined;
        if (invoked && !returned) {
          selectorDuration = Math.max(0, performance.now() - selectorStart);
          if (error instanceof RoutingError && error.selectorObservation) {
            usage = { totalTokens: finite(error.selectorObservation.totalTokens), cost: finite(error.selectorObservation.cost) };
          }
        }
        const receipt: DecisionReceipt = {
          version: 1, id, policyRevision: policy.revision, selection: safeSelection(policy, selection), operation,
          startedAt, durationMs: Math.max(0, performance.now() - start),
          outcome: code === "ABSTAINED" ? "abstained" : code === "ABORTED" ? "aborted" : code ? "error" : operation === "prepare" ? "prepared" : "assigned",
          ...(code ? { errorCode: code } : {}), ...(decisionId ? { decisionId } : {}),
          candidates: [...candidates.values()], ...(capacity ? { capacity } : {}), ...(!code && assigned ? { assignment: assigned } : {}),
          selector: { invoked, outcome: !invoked ? "not_invoked" : returned ? "returned" : code === "SELECTOR_UNAVAILABLE" ? "unavailable" : code === "SELECTOR_TIMEOUT" ? "timeout" : code === "ABORTED" ? "aborted" : "error",
            ...(selectorIdentity ? { identity: selectorIdentity } : {}), ...(selectorDuration !== undefined ? { durationMs: selectorDuration } : {}), usage },
        };
        const delivery: unknown = options.onReceipt?.(freeze(receipt));
        if (delivery && typeof (delivery as PromiseLike<unknown>).then === "function") void Promise.resolve(delivery).catch(() => {});
      } catch { /* The explicitly injected diagnostic sink is best-effort, not routing authority. */ }
    },
  };
}
export type ReceiptCapture = ReturnType<typeof createReceipt>;
