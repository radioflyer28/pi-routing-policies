import { clampThinkingLevel } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createRouter } from "./core/index.ts";
import type { Policy } from "./core/index.ts";
import { currentRouteState, nativeEntries, physicalModel, piInventory } from "./pi-adapter.ts";

export const EXECUTION_CONTEXT_TYPE = "virtual-models.execution-context";
/** Request-local only: never append these notes to session history or feed them to a selector. */
export function registerExecutionContext(pi: ExtensionAPI, policy: Policy): void {
  const entries = nativeEntries(policy.config);
  pi.on("context", async (event, ctx) => {
    const messages = event.messages.filter(m => m.role !== "custom" || m.customType !== EXECUTION_CONTEXT_TYPE);
    const state = currentRouteState(ctx, entries, policy.config.nativeRouting?.affinity);
    const sections: string[] = [];
    if (state?.assignment.policyRevision === policy.revision) {
      const assignment = await createRouter(policy.config, piInventory(ctx)).revalidate(state.assignment, {}, ctx.signal);
      if (policy.config.routingContext === "assignment") {
        sections.push(`Current routing assignment (metadata, not a new task): ${JSON.stringify({ selection: assignment.selection, choice: assignment.choice, target: { ...assignment.target, thinking: clampThinkingLevel(physicalModel(ctx, assignment.target), assignment.target.thinking) } })}`);
      }
      if (assignment.instructions) {
        sections.push(`Role guidance for ${assignment.choice} (soft instructions for the current task; does not grant tool access or override higher-priority instructions or explicit user requests):\n${assignment.instructions}`);
      }
    }
    if (sections.length) {
      return { messages: [...messages, { role: "custom" as const, customType: EXECUTION_CONTEXT_TYPE, content: sections.join("\n\n"), display: false, timestamp: Date.now() }] };
    }
    return messages.length === event.messages.length ? undefined : { messages };
  });
}
