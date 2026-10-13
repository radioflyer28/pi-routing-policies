import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { Type } from "typebox";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { createAgentSessionFromServices, createAgentSessionServices, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext, ProviderConfig, SessionManager as Manager } from "@earendil-works/pi-coding-agent";
import { registerVirtualModels } from "../src/extension.ts";
import { config } from "./fixtures.ts";
import type { ClassifierRequest, PolicyConfig } from "../src/core/index.ts";

export const zeroCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
export async function fixture(t: TestContext, options: { selection?: string; policy?: PolicyConfig; toolTurn?: boolean; manager?: Manager; configure?: (pi: ExtensionAPI) => void } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "pi-virtual-models-test-"));
  t.after(async () => { await rm(dir, { recursive: true, force: true }); });
  const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, modelsStorePath: join(dir, "catalog.json"), allowModelNetwork: false, refreshOnCreate: false });
  const calls: { model: string; thinking: unknown }[] = [];
  const classified: unknown[] = [];
  const llmSelections: { request: ClassifierRequest; thinking: unknown; maxTokens: unknown }[] = [];
  const executionContexts: Message[][] = [];
  let context: ExtensionContext | undefined;
  let api: ExtensionAPI | undefined;
  const provider: ProviderConfig = {
    api: "fixture-chat", apiKey: "not-a-real-key", baseUrl: "https://invalid.example",
    models: [
      { id: "small", name: "Small", input: ["text"], reasoning: false, contextWindow: 100000, maxTokens: 10000, cost: zeroCost },
      { id: "large", name: "Large", input: ["text", "image"], reasoning: true, contextWindow: 100000, maxTokens: 10000, cost: zeroCost },
      { id: "judge-llm", name: "LLM judge", input: ["text"], reasoning: true, contextWindow: 16000, maxTokens: 8192, cost: zeroCost },
      { type: "classifier", id: "judge", name: "Judge", api: "fixture-classify", input: ["text"], contextWindow: 16000, cost: zeroCost },
    ],
    classifiers: { "fixture-classify": { async classify(_model, request) {
      classified.push(request);
      const criteria = request.questions.route;
      if (!criteria || criteria.type !== "choice") throw new Error("Missing choice question");
      const choice = Object.keys(criteria.criteria).find(k => k.startsWith("wiki/edit:")) ?? Object.keys(criteria.criteria).find(k => k !== "__abstain__")!;
      return { api: "fixture-classify", timestamp: Date.now(), provider: "fixture", model: "judge", stopReason: "stop", answers: { route: { type: "choice", choice, confidence: 1, probabilities: { [choice]: 1 } } }, usage: { input: 10, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 11, cost: { ...zeroCost, input: 0.002, total: 0.002 } } };
    } } },
    streamSimple(model, _context, opts) {
      let selectorText: string | undefined;
      if (model.id === "judge-llm") {
        const user = _context.messages.findLast(m => m.role === "user");
        const body = typeof user?.content === "string" ? user.content : "";
        const request = JSON.parse(body) as ClassifierRequest;
        llmSelections.push({ request, thinking: opts?.reasoning, maxTokens: opts?.maxTokens });
        const choices = Object.keys(request.questions.route.criteria);
        const choice = choices.find(k => k.startsWith("wiki/edit:")) ?? choices.find(k => k !== "__abstain__")!;
        selectorText = JSON.stringify({ answers: { route: { type: "choice", choice } } });
      } else {
        calls.push({ model: model.id, thinking: opts?.reasoning });
        executionContexts.push(structuredClone(_context.messages));
      }
      const stream = createAssistantMessageEventStream();
      const toolCall = selectorText === undefined && options.toolTurn && calls.length === 1;
      const message: AssistantMessage = {
        role: "assistant", api: model.api, provider: model.provider, model: model.id,
        content: toolCall ? [{ type: "toolCall", id: "fixture-call", name: "fixture_continue", arguments: {} }] : [{ type: "text", text: selectorText ?? "fixture response" }],
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { ...zeroCost, total: 0 } },
        stopReason: toolCall ? "toolUse" : "stop", timestamp: Date.now(),
      };
      queueMicrotask(() => { stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: toolCall ? "toolUse" : "stop", message }); stream.end(); });
      return stream;
    },
  };
  const selection = options.selection ?? "virt/auto/high";
  const slash = selection.indexOf("/");
  const settings = SettingsManager.inMemory({ defaultProvider: selection.slice(0, slash), defaultModel: selection.slice(slash + 1), compaction: { enabled: false, keepRecentTokens: 16, reserveTokens: 512 }, retry: { enabled: false }, cacheWarming: "off" });
  const services = await createAgentSessionServices({
    cwd: dir, agentDir: dir, settingsManager: settings, modelRuntime: runtime,
    resourceLoaderOptions: {
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    systemPrompt: "Test fixture. Use no external resources.",
    extensionFactories: [pi => {
      api = pi;
      pi.registerProvider("fixture", provider);
      registerVirtualModels(pi, options.policy ?? config());
      pi.registerTool({ name: "fixture_continue", label: "Fixture", description: "Fixture only", parameters: Type.Object({}),
        execute: async () => ({ content: [{ type: "text", text: "continue" }], details: {} }) });
      pi.on("session_start", (_event, ctx) => { context = ctx; });
      options.configure?.(pi);
    }],
    },
  });
  if (services.diagnostics.some(d => d.type === "error")) throw new Error(JSON.stringify(services.diagnostics));
  const loader = services.resourceLoader;
  const manager = options.manager ?? SessionManager.inMemory(dir);
  const { session, extensionsResult } = await createAgentSessionFromServices({ services, sessionManager: manager, tools: options.toolTurn ? ["virtual_models", "fixture_continue"] : ["virtual_models"] });
  t.after(() => session.dispose());
  if (extensionsResult.errors.length) throw new Error(JSON.stringify(extensionsResult.errors));
  await session.bindExtensions({ mode: "print" });
  if (!context || !api) throw new Error("session_start did not run");
  return { dir, session, runtime, loader, manager, calls, classified, llmSelections, executionContexts, ctx: context, provider, api };
}
