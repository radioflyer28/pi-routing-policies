import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { Selector, SelectorConfig } from "./core/index.ts";
import { createClassifierSelector } from "./classifier.ts";
import { createLlmSelector } from "./llm.ts";

export { createClassifierSelector } from "./classifier.ts";
export { createLlmSelector } from "./llm.ts";
/** Select exactly the configured backend. There is no implicit backend or provider fallback. */
export function createSelector(
  registry: ModelRegistry,
  config?: SelectorConfig,
  onResult?: (metadata: Readonly<Record<string, unknown>>) => void,
): Selector | undefined {
  if (!config) return undefined;
  return config.kind === "classifier" ? createClassifierSelector(registry, config, onResult) : createLlmSelector(registry, config, onResult);
}
