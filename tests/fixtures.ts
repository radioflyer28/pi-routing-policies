import type { ClassifierSelectorConfig, PolicyConfig } from "../src/core/index.ts";
export function config(): PolicyConfig & { selector: ClassifierSelectorConfig } {
  return {
    version: 1,
    models: {
      "wiki/edit": { defaultEffort: "medium", efforts: {
        low: { provider: "fixture", model: "small", thinking: "off" },
        medium: { provider: "fixture", model: "small", thinking: "low" },
        high: { provider: "fixture", model: "large", thinking: "medium" },
      } },
      "code/review": { defaultEffort: "medium", efforts: {
        low: { provider: "fixture", model: "small", thinking: "low" },
        medium: { provider: "fixture", model: "large", thinking: "medium" },
        high: { provider: "fixture", model: "large", thinking: "high" },
      } },
    },
    questions: { route: { type: "choice", instructions: "Choose a suitable variant or abstain.", criteria: {
      "wiki/edit:low": "Mechanical wiki edits", "wiki/edit:medium": "Wiki synthesis", "wiki/edit:high": "Conflicting sources",
      "code/review:low": "Narrow code review", "code/review:medium": "Bounded correctness review", "code/review:high": "High-consequence review",
      __abstain__: "No suitable option",
    } } },
    selector: { kind: "classifier", provider: "fixture", model: "judge", timeoutMs: 1000 },
  };
}
export const available = () => ({ eligible: true });
export const answer = (choice: string) => ({ answers: { route: { type: "choice", choice } } });
