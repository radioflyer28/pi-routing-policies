import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateTokens, initTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionToolContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";
import { visibleWidth } from "@earendil-works/pi-tui";
import { nativeCapacity } from "../src/native-capacity.ts";
import { RoutingError } from "../src/core/index.ts";
import type { Assignment, CapacityMode, Decision, DecisionReceipt, PolicyConfig } from "../src/core/index.ts";
import type { RouteState } from "../src/pi-adapter.ts";
import { DECISION_RECEIPT_TYPE, receiptDetails } from "../src/decision-notice.ts";
import { renderRoutingNotice, ROUTING_NOTICE_TYPE } from "../src/routing-notice.ts";
import type { RoutingNotice } from "../src/routing-notice.ts";
import { config } from "./fixtures.ts";
import { fixture, zeroCost } from "./sdk-fixture.ts";
const error = (code: string) => (e: unknown) => e instanceof RoutingError && e.code === code;
function policy(mode: CapacityMode = "require-estimated-fit", inputEstimate: "pi-heuristic" | "unknown" = "pi-heuristic"): PolicyConfig {
  return { ...config(), nativeRouting: { affinity: "session", capacity: { mode, inputEstimate, outputReserveTokens: 512 } } };
}
function pin(f: Awaited<ReturnType<typeof fixture>>): RouteState {
  const entry = f.manager.getBranch().findLast(e => e.type === "custom" && e.customType === "pi.virtual-model-state");
  assert(entry?.type === "custom");
  return (entry.data as { state: RouteState }).state;
}
function receipt(f: Awaited<ReturnType<typeof fixture>>): DecisionReceipt {
  const entry = f.manager.getBranch().findLast(e => e.type === "custom" && e.customType === DECISION_RECEIPT_TYPE);
  assert(entry?.type === "custom");
  return (entry.data as { receipt: DecisionReceipt }).receipt;
}

test("native estimate uses full request text including system/tool declarations, not the selector window or old usage", () => {
  const messages: Message[] = [
    { role: "system", timestamp: 0, content: "SYSTEM ".repeat(1000), toolsAdded: [{ name: "demo", description: "tool schema", parameters: { type: "object", properties: {} } }] },
    { role: "user", timestamp: 1, content: "REQUEST ".repeat(3000) },
    { role: "assistant", api: "fixture-chat", provider: "fixture", model: "small", timestamp: 2,
      content: [{ type: "text", text: "ASSISTANT ".repeat(1000) }], stopReason: "stop",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { ...zeroCost, total: 0 } } },
    { role: "toolResult", timestamp: 2, toolCallId: "x", toolName: "demo", content: [{ type: "text", text: "TOOL_RESULT ".repeat(1000) }], isError: false },
  ];
  const requirement = nativeCapacity(policy(), messages, false)!;
  assert.equal(requirement.inputTokens, messages.reduce((sum, m) => sum + estimateTokens(m), 0));
  assert(requirement.inputTokens! > 3000);
  assert.equal(requirement.estimateSource, "pi-heuristic");
  assert.equal(nativeCapacity(config(), messages, false), undefined);
  assert.equal(nativeCapacity(policy("require-estimated-fit", "unknown"), messages, false)?.inputTokens, null);
});

test("native images and later own execution-context additions are unknown, not a made-up exact count", () => {
  const messages: Message[] = [{ role: "user", timestamp: 1, content: [{ type: "image", mimeType: "image/png", data: "SECRET_IMAGE" }] }];
  assert.equal(nativeCapacity(policy(), messages, false)?.inputTokens, null);
  const withGuidance = { ...policy(), models: { ...config().models, "wiki/edit": { ...config().models["wiki/edit"]!, instructions: "later guidance" } } };
  const text: Message[] = [{ role: "user", content: "text", timestamp: 2 }];
  assert.equal(nativeCapacity(withGuidance, text, false)?.inputTokens, null);
  assert.equal(nativeCapacity({ ...policy(), routingContext: "assignment" }, text, false)?.inputTokens, null);
  assert.equal(nativeCapacity(withGuidance, text, true)?.inputTokens, 1);
  assert.equal(nativeCapacity(policy("allow-compaction"), text, true)?.mode, "require-estimated-fit");
});

test("strict native unknown fails before inference; permissive input unknown is labeled, not a fit", async t => {
  const strict = await fixture(t, { policy: policy("require-estimated-fit", "unknown") });
  await strict.session.prompt("Unmeasured execution request");
  assert.equal(strict.classified.length, 0);
  assert.equal(strict.calls.length, 0);
  assert.equal(receipt(strict).errorCode, "NO_CANDIDATES");
  assert(receipt(strict).candidates.filter(c => c.stage !== "filter").every(c => c.reason === "capacity_unknown"));
  const permissive = await fixture(t, { policy: policy("allow-compaction", "unknown") });
  await permissive.session.prompt("Unmeasured request delegated to Pi");
  assert.equal(permissive.classified.length, 1);
  assert.equal(pin(permissive).assignment.capacity?.inputTokens, null);
  assert(receipt(permissive).candidates.filter(c => c.capacity).every(c => c.capacity?.status === "unknown"));
});

for (const kind of ["classifier", "llm"] as const) test(`${kind} native capacity excludes undersized candidates without changing fixed effort or generation options`, async t => {
  const p = { ...policy(), ...(kind === "llm" ? { selector: { kind, provider: "fixture", model: "judge-llm", thinking: "off" as const } } : {}) };
  const f = await fixture(t, { policy: p, selection: "virt/auto" });
  const sentLimits: unknown[] = [];
  f.runtime.registerProvider("fixture", { ...f.provider,
    models: f.provider.models!.map(m => m.id === "small" ? { ...m, maxTokens: 100 } : m),
    streamSimple(model, context, options) { if (model.id !== "judge-llm") sentLimits.push(options?.maxTokens); return f.provider.streamSimple!(model, context, options); },
  });
  await f.session.prompt("PRIVATE_CAPACITY_TASK");
  assert.equal(pin(f).assignment.choice, "wiki/edit:high");
  assert.equal(f.calls[0]?.thinking, "medium");
  assert.deepEqual(sentLimits, [undefined]);
  assert.equal(receipt(f).candidates.find(c => c.choice === "wiki/edit:low")?.reason, "capacity_output");
  assert(!JSON.stringify(receipt(f)).includes("PRIVATE_CAPACITY_TASK"));
  await f.session.prompt("/vmodel virt/auto:low");
  await f.session.prompt("Fixed effort must not be widened");
  assert.equal(f.classified.length + f.llmSelections.length, 1);
  assert.equal(f.calls.length, 1);
  assert.equal(receipt(f).errorCode, "NO_CANDIDATES");
});

test("session affinity recomputes growing execution input and rejects the pin without reselecting", async t => {
  const f = await fixture(t, { policy: policy(), selection: "virt/auto/low" });
  await f.session.prompt("Small initial task");
  const old = pin(f).assignment.capacity!;
  f.runtime.registerProvider("fixture", { ...f.provider, models: f.provider.models!.map(m => m.id === "small" ? { ...m, contextWindow: old.inputTokens! + old.outputReserveTokens + 100 } : m) });
  await f.session.prompt("New evidence: " + "DETAIL ".repeat(5000));
  assert.equal(f.classified.length, 1);
  assert.equal(f.calls.length, 1);
  assert.equal(receipt(f).errorCode, "INELIGIBLE");
  assert.equal(receipt(f).candidates[0]?.reason, "capacity_context");
  assert(receipt(f).capacity!.inputTokens! > old.inputTokens!);
});

test("permitted compaction is reported without claiming it ran, even when host compaction is disabled", async t => {
  const f = await fixture(t, { policy: policy("allow-compaction") });
  f.runtime.registerProvider("fixture", { ...f.provider, models: f.provider.models!.map(m => m.id === "large" ? { ...m, contextWindow: 600 } : m) });
  await f.session.prompt("Long input. ".repeat(2000));
  assert.equal(f.calls.length, 1);
  assert.equal(pin(f).assignment.capacity?.mode, "allow-compaction");
  assert.equal(receipt(f).candidates.find(c => c.choice === "wiki/edit:high")?.capacity?.status, "context_exceeded");
  assert(!f.manager.getBranch().some(e => e.type === "compaction"));
  assert(receiptDetails(receipt(f)).join("\n").includes("not proof it is enabled or will succeed"));
});

test("direct routes assess their own request strictly without classification or recursive compaction", async t => {
  const p: PolicyConfig = { ...policy("allow-compaction"), direct: { provider: "fixture", model: "large", thinking: "medium" } };
  const f = await fixture(t, { policy: p });
  const direct = await f.runtime.resolveModel(f.session.model!, [{ role: "user", content: "Short summary", timestamp: 1 }], { reason: "direct", thinkingLevel: "off" });
  assert.equal(direct.model.id, "large");
  assert.equal(direct.state, undefined);
  const entry = f.manager.getBranch().findLast(e => e.type === "custom" && e.customType === ROUTING_NOTICE_TYPE);
  assert(entry?.type === "custom");
  const notice = entry.data as RoutingNotice;
  assert.equal(notice.directCapacity?.requirement.mode, "require-estimated-fit");
  assert.equal(notice.directCapacity?.assessment.status, "estimated_fit");
  initTheme("dark", false);
  const theme = { fg: (_color: string, text: string) => text } as Theme;
  for (const width of [10, 30, 80]) assert(renderRoutingNotice(notice, true, theme).render(width).every(line => visibleWidth(line) <= width));
  await assert.rejects(f.runtime.resolveModel(f.session.model!, [{ role: "user", content: "X".repeat(500000), timestamp: 2 }], { reason: "direct", thinkingLevel: "off" }), error("INELIGIBLE"));
  assert.equal(receipt(f).candidates[0]?.choice, "direct");
  assert.equal(receipt(f).candidates[0]?.reason, "capacity_context");
  assert.equal(f.classified.length, 0);
  assert.equal(f.calls.length, 0);
});

test("current metadata is rechecked after an unchanged-policy reload", async t => {
  const f = await fixture(t, { policy: policy() });
  await f.session.prompt("First task");
  await f.session.reload();
  f.runtime.registerProvider("fixture", { ...f.provider, models: f.provider.models!.map(m => m.id === "large" ? { ...m, maxTokens: 1 } : m) });
  await f.session.prompt("Continue with invalid output capacity");
  assert.equal(f.calls.length, 1);
  assert.equal(receipt(f).candidates[0]?.reason, "capacity_output");
});

test("native acceptance rejects a capacity reduction during selector execution without substituting a model", async t => {
  const f = await fixture(t, { policy: policy() });
  const classifier = f.provider.classifiers!["fixture-classify"]!;
  f.runtime.registerProvider("fixture", { ...f.provider, classifiers: { "fixture-classify": { async classify(model, request, options) {
    const result = await classifier.classify(model, request, options);
    f.runtime.registerProvider("fixture", { ...f.provider, models: f.provider.models!.map(m => m.id === "large" ? { ...m, maxTokens: 1 } : m) });
    return result;
  } } } });
  await f.session.prompt("Capacity revoked after proposal");
  assert.equal(f.classified.length, 1);
  assert.equal(f.calls.length, 0);
  assert.equal(receipt(f).selector.invoked, true);
  assert.equal(receipt(f).candidates.find(c => c.choice === "wiki/edit:high")?.reason, "capacity_output");
});

test("compaction and resume refresh native input estimates without reclassifying a valid affinity pin", async t => {
  const p = policy("allow-compaction");
  const first = await fixture(t, { policy: p });
  await first.session.prompt("Initial evidence. ".repeat(1000));
  await first.session.prompt("Recent evidence. ".repeat(100));
  const before = pin(first).assignment;
  await first.session.compact();
  assert(first.manager.getBranch().some(e => e.type === "compaction"));
  assert.equal(first.classified.length, 1);
  first.session.dispose();
  const resumed = await fixture(t, { policy: p, manager: first.manager });
  await resumed.session.prompt("Continue after compaction and resume");
  assert.equal(resumed.classified.length, 0);
  assert.equal(pin(resumed).assignment.decisionId, before.decisionId);
  assert(pin(resumed).assignment.capacity!.inputTokens! < before.capacity!.inputTokens!);
});

test("coordinator decisions retain caller capacity across answer and never infer child input from parent context", async t => {
  const f = await fixture(t);
  const tool = f.session.getToolDefinition("virtual_models")!;
  const ctx = { ...f.ctx, tools: [], executeTool: async () => { throw new Error("no nested tools"); } } as ExtensionToolContext;
  const call = (args: object) => tool.execute("capacity", args, undefined, undefined, ctx);
  const capacity = { mode: "require-estimated-fit", inputTokens: 20000, outputReserveTokens: 4096, estimateSource: "caller" };
  const prepared = (await call({ action: "prepare", selection: "virt/auto:high", state: { task: "Small description, large child context" }, capacity })).details as Decision;
  const resolved = (await call({ action: "answer", decisionId: prepared.id, choice: "wiki/edit:high" })).details as Assignment;
  assert.deepEqual(resolved.capacity, capacity);
  assert.equal(f.classified.length, 0);
  assert.equal(f.calls.length, 0);
  await assert.rejects(call({ action: "resolve", selection: "wiki/edit:low", capacity: { ...capacity, outputReserveTokens: 10001 } }), error("INELIGIBLE"));
});

test("preview/doctor expose policy facts but do not claim execution fit from their diagnostic task", async t => {
  const f = await fixture(t, { policy: policy("require-estimated-fit", "unknown") });
  await f.session.prompt("/vmodel doctor");
  let entry = f.manager.getBranch().findLast(e => e.type === "custom" && e.customType === "virtual-models.diagnostic");
  assert(entry?.type === "custom");
  assert.deepEqual((entry.data as any).report.nativeCapacity, policy("require-estimated-fit", "unknown").nativeRouting?.capacity);
  await f.session.prompt("/vmodel preview --allow-inference virt/auto:high -- Diagnostic only");
  entry = f.manager.getBranch().findLast(e => e.type === "custom" && e.customType === "virtual-models.diagnostic");
  assert(entry?.type === "custom");
  assert((entry.data as any).report.note.includes("Execution capacity is not assessed"));
  assert.equal(f.classified.length, 1);
  assert.equal(f.calls.length, 0);
});
