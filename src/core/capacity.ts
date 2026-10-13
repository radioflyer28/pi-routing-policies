import { RoutingError } from "./types.ts";
import type { CapacityAssessment, CapacityExclusionCode, CapacityLimits, CapacityRequirement } from "./types.ts";

export const MAX_CAPACITY_TOKENS = 1_000_000_000;
const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= MAX_CAPACITY_TOKENS;
export function capacityRequirement(input: unknown, code: "INVALID_CONFIG" | "INVALID_SELECTION" = "INVALID_SELECTION"): CapacityRequirement {
  const invalid = () => { throw new RoutingError(code, "Capacity requires a mode, inputTokens (count or null), outputReserveTokens and estimateSource; counts must be integers from 0 to 1000000000"); };
  if (!input || typeof input !== "object" || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return invalid();
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !["mode", "inputTokens", "outputReserveTokens", "estimateSource"].includes(key))) return invalid();
  const { mode, inputTokens, outputReserveTokens, estimateSource } = value;
  if ((mode !== "require-estimated-fit" && mode !== "allow-compaction") ||
      (inputTokens !== null && !count(inputTokens)) || !count(outputReserveTokens) ||
      (estimateSource !== "caller" && estimateSource !== "pi-heuristic" && estimateSource !== "unknown") ||
      (estimateSource === "unknown" && inputTokens !== null)) return invalid();
  return Object.freeze({ mode, inputTokens, outputReserveTokens, estimateSource });
}
/** A fresh input estimate can replace the old one, but original mode/output requirements cannot be dropped. */
export function mergeCapacity(original?: CapacityRequirement, next?: CapacityRequirement): CapacityRequirement | undefined {
  const previous = original === undefined ? undefined : capacityRequirement(original);
  const current = next === undefined ? undefined : capacityRequirement(next);
  if (!previous) return current;
  if (!current) return previous;
  return Object.freeze({ ...current, mode: previous.mode === "require-estimated-fit" ? previous.mode : current.mode,
    outputReserveTokens: Math.max(previous.outputReserveTokens, current.outputReserveTokens) });
}
export function observedCapacity(limits?: CapacityLimits): Pick<CapacityAssessment, "contextWindow" | "maxOutputTokens"> {
  const positive = (value: unknown) => count(value) && value > 0 ? value : null;
  return Object.freeze({ contextWindow: positive(limits?.contextWindow), maxOutputTokens: positive(limits?.maxOutputTokens) });
}
/** Numeric registry observations only. No policy state, text or provider prose can enter an assessment. */
export function assessCapacity(requirement: CapacityRequirement, limits?: CapacityLimits): {
  eligible: boolean; code?: CapacityExclusionCode; assessment: CapacityAssessment;
} {
  const req = capacityRequirement(requirement);
  const { contextWindow, maxOutputTokens } = observedCapacity(limits);
  let status: CapacityAssessment["status"];
  let code: CapacityExclusionCode | undefined;
  if (maxOutputTokens !== null && req.outputReserveTokens > maxOutputTokens) {
    status = "output_exceeded"; code = "capacity_output";
  } else if (contextWindow !== null && req.outputReserveTokens > contextWindow) {
    status = "context_exceeded"; code = "capacity_context";
  } else if (maxOutputTokens === null) {
    status = "unknown"; code = "capacity_unknown";
  } else if (contextWindow === null || req.inputTokens === null) {
    status = "unknown";
    if (req.mode === "require-estimated-fit") code = "capacity_unknown";
  } else if (req.inputTokens + req.outputReserveTokens > contextWindow) {
    status = "context_exceeded";
    if (req.mode === "require-estimated-fit") code = "capacity_context";
  } else status = "estimated_fit";
  return Object.freeze({ eligible: code === undefined, ...(code ? { code } : {}), assessment: Object.freeze({ contextWindow, maxOutputTokens, status }) });
}
