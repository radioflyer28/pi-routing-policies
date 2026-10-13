import assert from "node:assert/strict";
import { test } from "node:test";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessage, Model, Api } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { createLlmSelector } from "../src/llm.ts";
import { createRouter, RoutingError } from "../src/core/index.ts";
import type { DecisionReceipt, LlmSelectorConfig } from "../src/core/index.ts";
import { answer, available, config } from "./fixtures.ts";

const error = (code: string) => (e: unknown) => e instanceof RoutingError && e.code === code;
const selectorConfig: LlmSelectorConfig = { kind: "llm", provider: "fixture", model: "judge/chat:v1", thinking: "low", timeoutMs: 1000, maxTokens: 512 };
const model: Model<Api> = { type: "chat", id: selectorConfig.model, name: "Judge", provider: "fixture", api: "fixture-chat", baseUrl: "https://invalid.example", input: ["text"], reasoning: true, contextWindow: 16000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
function response(text: string, stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
  return { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: 0, content: [{ type: "text", text }], stopReason,
    usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { ...model.cost, total: 0 } } };
}
function stream(message: AssistantMessage) {
  const result = createAssistantMessageEventStream();
  queueMicrotask(() => {
    if (message.stopReason === "error" || message.stopReason === "aborted") result.push({ type: "error", reason: message.stopReason, error: message });
    else if (message.stopReason !== "pending") result.push({ type: "done", reason: message.stopReason, message });
    result.end();
  });
  return result;
}
function client(message = response(JSON.stringify(answer("wiki/edit:high")))): Pick<ModelRegistry, "find" | "hasConfiguredAuth" | "streamSimple"> {
  return { find: () => model, hasConfiguredAuth: () => true, streamSimple: () => stream(message) };
}

test("LLM selector uses one native physical call with the shared policy, independent thinking and no execution tools", async () => {
  const router = createRouter(config(), available);
  const decision = await router.prepare("virt/auto:high", { task: "Review documentation" });
  const registry = client();
  let calls = 0;
  let metadata: unknown;
  registry.streamSimple = (selected, context, options) => {
    calls++;
    assert.equal(selected, model);
    assert.equal(options?.reasoning, "low");
    assert.equal(options?.maxTokens, 512);
    assert(options?.signal);
    assert.equal(context.tools, undefined);
    assert.equal(context.messages.length, 2);
    const user = context.messages[1]!;
    assert.equal(typeof user.content, "string");
    assert.deepEqual(JSON.parse(user.content as string), decision.request);
    return stream(response(JSON.stringify(answer("wiki/edit:high"))));
  };
  const selected = await createLlmSelector(registry, selectorConfig, m => { metadata = m; }).select(decision.request);
  assert.equal(calls, 1);
  assert.equal(selected.metadata, metadata);
  assert.equal(selected.metadata?.kind, "llm");
  assert.equal(selected.metadata?.effectiveThinking, "low");
  assert.equal(selected.metadata?.confidence, undefined);
  const assignment = await router.accept(decision, selected.answer);
  assert.equal(assignment.target.thinking, "medium");
});

test("LLM selector reports clamping without conflating requested and effective reasoning", async () => {
  const registry = client();
  registry.find = () => ({ ...model, reasoning: false });
  registry.streamSimple = (_m, _r, options) => {
    assert.equal(options?.reasoning, undefined);
    return stream(response(JSON.stringify(answer("wiki/edit:high"))));
  };
  const request = (await createRouter(config(), available).prepare("virt/auto", {})).request;
  const result = await createLlmSelector(registry, { ...selectorConfig, thinking: "high" }).select(request);
  assert.equal(result.metadata?.requestedThinking, "high");
  assert.equal(result.metadata?.effectiveThinking, "off");
});

test("LLM selection rejects malformed, unoffered, fenced, oversized and incomplete answers without fallback", async () => {
  for (const text of ["not JSON", "null", "{}", "```json\n{}\n```", JSON.stringify(answer("other/role:high")), "x".repeat(65537)]) {
    const router = createRouter(config(), available);
    await assert.rejects(router.select("virt/auto:high", {}, createLlmSelector(client(response(text)), selectorConfig)), error("INVALID_ANSWER"));
  }
  for (const stop of ["length", "toolUse", "error", "aborted"] as const) {
    const request = (await createRouter(config(), available).prepare("virt/auto", {})).request;
    await assert.rejects(createLlmSelector(client(response("secret-provider-payload", stop)), selectorConfig).select(request), error(stop === "aborted" ? "ABORTED" : "SELECTOR_ERROR"));
  }
  const router = createRouter(config(), available);
  await assert.rejects(router.select("virt/auto", {}, createLlmSelector(client(response(JSON.stringify(answer("__abstain__")))), selectorConfig)), error("ABSTAINED"));
});

test("LLM receipts retain reported usage after malformed or incomplete responses", async () => {
  for (const stop of ["stop", "length", "aborted"] as const) {
    const receipts: DecisionReceipt[] = [];
    const router = createRouter(config(), available, { onReceipt: receipt => { receipts.push(receipt); } });
    await assert.rejects(router.select("virt/auto", { task: "PRIVATE_TASK" }, createLlmSelector(client(response("PRIVATE_INVALID_JSON", stop)), selectorConfig)));
    assert.equal(receipts.length, 1);
    assert.deepEqual(receipts[0]?.selector.usage, { totalTokens: 15, cost: 0 });
    assert.equal(receipts[0]?.selector.identity?.kind, "llm");
    assert(!JSON.stringify(receipts).includes("PRIVATE"));
  }
});

test("LLM timeout receipts distinguish unknown charges from returned zero cost", async () => {
  const receipts: DecisionReceipt[] = [];
  const registry = client();
  registry.streamSimple = () => createAssistantMessageEventStream();
  const router = createRouter(config(), available, { onReceipt: receipt => { receipts.push(receipt); } });
  await assert.rejects(router.select("virt/auto", {}, createLlmSelector(registry, { ...selectorConfig, timeoutMs: 10 })), error("SELECTOR_TIMEOUT"));
  assert.equal(receipts[0]?.selector.outcome, "timeout");
  assert.deepEqual(receipts[0]?.selector.usage, { totalTokens: null, cost: null });
});

test("LLM selector refuses missing, unauthenticated, image-only and virtual selector models", async () => {
  const request = (await createRouter(config(), available).prepare("virt/auto", {})).request;
  for (const target of [undefined, { ...model, api: "pi-virtual" }, { ...model, input: ["image"] as ["image"] }]) {
    const registry = client(); registry.find = () => target;
    registry.streamSimple = () => { throw new Error("must not call"); };
    await assert.rejects(createLlmSelector(registry, selectorConfig).select(request), error("SELECTOR_UNAVAILABLE"));
  }
  const registry = client(); registry.hasConfiguredAuth = () => false;
  await assert.rejects(createLlmSelector(registry, selectorConfig).select(request), error("SELECTOR_UNAVAILABLE"));
});

test("LLM timeout and abort bound uncooperative streams and redact provider errors", async () => {
  const request = (await createRouter(config(), available).prepare("virt/auto", {})).request;
  let inner: AbortSignal | undefined;
  let reports = 0;
  const registry = client();
  registry.streamSimple = (_m, _r, options) => { inner = options?.signal; return createAssistantMessageEventStream(); };
  const selector = createLlmSelector(registry, { ...selectorConfig, timeoutMs: 15 }, () => { reports++; });
  await assert.rejects(selector.select(request), error("SELECTOR_TIMEOUT"));
  assert(inner?.aborted);
  assert.equal(reports, 0);
  await assert.rejects(selector.select(request, AbortSignal.abort()), error("ABORTED"));
  const controller = new AbortController();
  const active = createLlmSelector(registry, selectorConfig).select(request, controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(active, error("ABORTED"));
  assert(inner?.aborted);
  registry.streamSimple = () => { throw new Error("secret-token"); };
  await assert.rejects(selector.select(request), e => e instanceof RoutingError && e.code === "SELECTOR_ERROR" && !e.message.includes("secret-token"));
});
