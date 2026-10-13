import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { RoutingError } from "./core/index.ts";
import type { Selector, ClassifierSelectorConfig, SelectionResult } from "./core/index.ts";
import { parseSelectorConfig } from "./core/policy.ts";
import { selectorCall } from "./selector-call.ts";
import { observedSelectorResult } from "./core/receipt.ts";

/** Native Pi classifier execution; no pi-typesafe extension or chat-prompt proxy. */
export function createClassifierSelector(
  registry: Pick<ModelRegistry, "findOfType" | "classify">,
  input: ClassifierSelectorConfig,
  onResult?: (metadata: Readonly<Record<string, unknown>>) => void,
): Selector {
  const config = parseSelectorConfig(input);
  if (config.kind !== "classifier") throw new RoutingError("INVALID_CONFIG", "Expected classifier selector configuration");
  return {
    identity: Object.freeze({ kind: config.kind, provider: config.provider, model: config.model }),
    async select(request, signal): Promise<SelectionResult> {
      const started = Date.now();
      const result = await selectorCall(config.timeoutMs ?? 10_000, signal, async innerSignal => {
        const model = registry.findOfType("classifier", config.provider, config.model);
        if (!model) throw new RoutingError("SELECTOR_UNAVAILABLE", "Configured classifier is not in the model registry");
        return registry.classify(model, request, { signal: innerSignal });
      });
      if (!result || typeof result !== "object") throw new RoutingError("SELECTOR_ERROR", "Malformed classifier response");
      const stopReason = ["stop", "error", "aborted"].includes(result.stopReason) ? result.stopReason : "error";
      const metadata = {
        kind: config.kind, provider: config.provider, model: config.model,
        durationMs: Date.now() - started, stopReason,
        ...(result.usage ? { usage: result.usage } : {}),
        ...(result.answers?.route?.type === "choice" ? { confidence: result.answers.route.confidence, probabilities: result.answers.route.probabilities } : {}),
      };
      onResult?.(metadata);
      return observedSelectorResult(metadata, () => {
        if (result.stopReason === "aborted") throw new RoutingError("ABORTED", "Classifier request aborted");
        if (result.stopReason !== "stop") throw new RoutingError("SELECTOR_ERROR", "Classifier request failed; inspect provider configuration (no fallback applied)");
        return { answer: { answers: result.answers }, metadata };
      });
    },
  };
}
