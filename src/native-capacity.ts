import { estimateTokens } from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";
import type { CapacityRequirement, PolicyConfig } from "./core/index.ts";
import { MAX_CAPACITY_TOKENS } from "./core/capacity.ts";

/** Local, opt-in estimate of the whole routing request, never the selector's truncated task state.
 * No inference, historical provider usage, tokenizer invention or generation-budget mutation. */
export function nativeCapacity(config: PolicyConfig, messages: readonly Message[], direct: boolean): CapacityRequirement | undefined {
  const capacity = config.nativeRouting?.capacity;
  if (!capacity) return undefined;
  let inputTokens: number | null = null;
  const hasImages = messages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === "image"));
  const laterOwnContext = !direct && (config.routingContext === "assignment" || Object.values(config.models).some(role => !!role.instructions));
  if (capacity.inputEstimate === "pi-heuristic" && !hasImages && !laterOwnContext) {
    const estimate = messages.reduce((sum, message) => sum + estimateTokens(message), 0);
    if (Number.isSafeInteger(estimate) && estimate >= 0 && estimate <= MAX_CAPACITY_TOKENS) inputTokens = estimate;
  }
  return Object.freeze({ mode: direct ? "require-estimated-fit" : capacity.mode, outputReserveTokens: capacity.outputReserveTokens,
    inputTokens, estimateSource: inputTokens === null ? "unknown" : "pi-heuristic" });
}
