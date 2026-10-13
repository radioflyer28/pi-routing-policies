import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionCommandContext, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { createVirtualDefinitions, RESELECT_TYPE } from "../src/pi-adapter.ts";
import type { RouteState } from "../src/pi-adapter.ts";
import { RoutingError } from "../src/core/index.ts";
import type { ClassifierRequest, PolicyConfig } from "../src/core/index.ts";
import { config } from "./fixtures.ts";
import { fixture } from "./sdk-fixture.ts";
import { ROUTING_NOTICE_TYPE } from "../src/routing-notice.ts";
import type { RoutingNotice } from "../src/routing-notice.ts";
import { EXECUTION_CONTEXT_TYPE } from "../src/execution-context.ts";
const error = (code: string) => (e: unknown) => e instanceof RoutingError && e.code === code;
function policy(affinity: "turn" | "session" = "session"): PolicyConfig {
  return { ...config(), nativeRouting: { affinity, context: { includeAssistant: true } } };
}
function state(f: Awaited<ReturnType<typeof fixture>>): RouteState {
  const entry = f.manager.getBranch().findLast(e => e.type === "custom" && e.customType === "pi.virtual-model-state");
  assert(entry?.type === "custom");
  return (entry.data as { state: RouteState }).state;
}

for (const kind of ["classifier", "llm"] as const) test(`${kind} sees actual bounded dialogue, not tools/custom guidance or execution context`, async t => {
  const p = { ...policy("turn"), routingContext: "assignment" as const,
    models: { ...config().models, "wiki/edit": { ...config().models["wiki/edit"]!, instructions: "SECRET_ROLE_GUIDANCE" } },
    ...(kind === "llm" ? { selector: { kind, provider: "fixture", model: "judge-llm", thinking: "off" as const } } : {}) };
  const f = await fixture(t, { policy: p, toolTurn: true });
  await f.session.prompt("TASK_SENTINEL: review tenant isolation.");
  f.manager.appendCustomMessageEntry("fixture-secret", "SECRET_CUSTOM_MESSAGE", false);
  await f.session.prompt("yes, proceed");
  const requests = kind === "llm" ? f.llmSelections.map(s => s.request) : f.classified as ClassifierRequest[];
  assert.equal(requests.length, 2);
  const request = requests[1]!;
  assert.equal(request.state.task, "yes, proceed");
  assert.deepEqual(request.state.recentDialogue, [
    { role: "user", text: "TASK_SENTINEL: review tenant isolation.", truncated: false },
    { role: "assistant", text: "fixture response", truncated: false },
  ]);
  assert(!JSON.stringify(request).includes("SECRET_"));
  assert(!JSON.stringify(request).includes("fixture_continue"));
  assert(f.executionContexts.every(messages => JSON.stringify(messages).includes("SECRET_ROLE_GUIDANCE")));
  const diagnostics = f.manager.getBranch().filter(e => e.type === "custom" && e.customType !== "pi.virtual-model-state");
  assert(!JSON.stringify(diagnostics).includes("TASK_SENTINEL"));
  const notice = f.manager.getBranch().findLast(e => e.type === "custom" && e.customType === ROUTING_NOTICE_TYPE);
  assert(notice?.type === "custom");
  assert.equal((notice.data as RoutingNotice).contextSummary?.historyMessages, 2);
});

test("session affinity reuses across user and tool turns; reselect resets without inference or model/thinking change", async t => {
  const f = await fixture(t, { policy: policy(), toolTurn: true });
  await f.session.prompt("Review authentication.");
  const assignment = state(f).assignment;
  await f.session.prompt("yes, proceed");
  assert.equal(f.classified.length, 1);
  assert.equal(f.calls.length, 3);
  assert.equal(state(f).assignment.decisionId, assignment.decisionId);
  const model = f.session.model;
  const thinking = f.session.thinkingLevel;
  await f.session.prompt("/vmodel reselect");
  assert.equal(f.session.model, model);
  assert.equal(f.session.thinkingLevel, thinking);
  assert.equal(f.classified.length, 1);
  assert(f.manager.getBranch().some(e => e.type === "custom" && e.customType === RESELECT_TYPE));
  await f.session.prompt("/vmodel");
  const status = f.manager.getBranch().findLast(e => e.type === "custom" && e.customType === "virtual-models.diagnostic");
  assert(status?.type === "custom");
  const native = (status.data as { report: { nativeRouting: { affinity: string; currentChoice: string | null; context: { includeAssistant: boolean } } } }).report.nativeRouting;
  assert.equal(native.affinity, "session");
  assert.equal(native.currentChoice, null);
  assert.equal(native.context.includeAssistant, true);
  assert.equal(f.classified.length, 1);
  await assert.rejects(f.runtime.resolveModel(model!, [], { reason: "direct", thinkingLevel: "off" }), error("NO_ASSIGNMENT"));
  await f.session.prompt("A new task.");
  assert.equal(f.classified.length, 2);
  assert.notEqual(state(f).assignment.decisionId, assignment.decisionId);
  // Reset is not dialogue deletion: the opted-in window still applies.
  assert(((f.classified.at(-1) as ClassifierRequest).state.recentDialogue as unknown[]).length > 0);
  await f.session.prompt("/virtual-model reselect");
  await f.session.prompt("Another new task.");
  assert.equal(f.classified.length, 3);
});

test("manual selections override affinity, including switching away and back to the same native identity", async t => {
  const f = await fixture(t, { policy: policy() });
  await f.session.prompt("Initial task");
  await f.session.prompt("/vmodel wiki/edit:low");
  await f.session.prompt("Explicit work");
  assert.equal(f.classified.length, 1);
  assert.equal(f.calls.at(-1)?.model, "small");
  const command = f.loader.getExtensions().extensions.flatMap(e => [...e.commands.values()]).find(c => c.description?.includes("reselect"))!;
  const ctx = { ...f.ctx, model: f.session.model, waitForIdle: async () => {} } as ExtensionCommandContext;
  await assert.rejects(command.handler("reselect", ctx), error("INVALID_SELECTION"));
  await assert.rejects(command.handler("reselect now", ctx), error("INVALID_SELECTION"));
  await f.session.prompt("/vmodel virt/auto:high");
  await f.session.prompt("Back to automatic");
  assert.equal(f.classified.length, 2);
  await f.session.setModel(f.ctx.modelRegistry.find("fixture", "large")!);
  await f.session.setModel(f.ctx.modelRegistry.find("virt", "auto/high")!);
  await f.session.prompt("Back through native model changes");
  assert.equal(f.classified.length, 3);
});

test("affinity revalidation rejects new image requirements and revoked targets without reclassification", async t => {
  const f = await fixture(t, { policy: policy(), selection: "virt/auto/low" });
  await f.session.prompt("Text only");
  const pin = state(f);
  await assert.rejects(f.runtime.resolveModel(f.session.model!, [{ role: "user", timestamp: Date.now(), content: [{ type: "image", data: "AA==", mimeType: "image/png" }] }],
    { reason: "user", thinkingLevel: "off", state: pin }), error("INELIGIBLE"));
  assert.equal(f.classified.length, 1);
  f.runtime.unregisterProvider("fixture");
  await assert.rejects(f.runtime.resolveModel(f.session.model!, [], { reason: "user", thinkingLevel: "off", state: pin }), error("INELIGIBLE"));
  assert.equal(f.calls.length, 1);
});

test("affinity survives unchanged reload and compaction, while policy changes fail closed until reselection", async t => {
  const raw = JSON.parse(JSON.stringify(policy()));
  const f = await fixture(t, { policy: raw });
  await f.session.prompt("Review sources. " + "evidence ".repeat(1000));
  const id = state(f).assignment.decisionId;
  await f.session.reload();
  await f.session.prompt("Continue with the plan. " + "Recent evidence. ".repeat(100));
  assert.equal(f.classified.length, 1);
  assert.equal(state(f).assignment.decisionId, id);
  await f.session.compact();
  await f.session.prompt("Proceed after compaction");
  assert.equal(f.classified.length, 1);
  raw.models["wiki/edit"].efforts.high.thinking = "high";
  await f.session.reload();
  const before = f.calls.length;
  await f.session.prompt("Continue after changing policy");
  assert.equal(f.calls.length, before);
  assert.equal(f.classified.length, 1);
  await f.session.prompt("/vmodel reselect");
  await f.session.prompt("Select under the new policy");
  assert.equal(f.classified.length, 2);
  assert.equal(f.calls.at(-1)?.thinking, "high");
});

test("resume and forks inherit ancestral affinity, while branch resets never affect another branch", async t => {
  const first = await fixture(t, { policy: policy() });
  await first.session.prompt("Original task");
  const pin = state(first).assignment.decisionId;
  const branchPoint = first.manager.getLeafId()!;
  first.session.dispose();
  const resumed = await fixture(t, { manager: first.manager, policy: policy() });
  await resumed.session.prompt("Continue the original task");
  assert.equal(resumed.classified.length, 0);
  assert.equal(state(resumed).assignment.decisionId, pin);
  await resumed.session.prompt("/vmodel reselect");
  await resumed.session.prompt("Different branch task");
  assert.equal(resumed.classified.length, 1);
  resumed.session.dispose();
  first.manager.createBranchedSession(branchPoint);
  const fork = await fixture(t, { manager: first.manager, policy: policy() });
  await fork.session.prompt("Continue inherited task");
  assert.equal(fork.classified.length, 0);
  assert.equal(state(fork).assignment.decisionId, pin);
  const fresh = await fixture(t, { policy: policy() });
  await fresh.session.prompt("New session task");
  assert.equal(fresh.classified.length, 1);
  assert.notEqual(state(fresh).assignment.decisionId, pin);
});

test("reselection failure cannot resurrect an old pin on retry or direct calls", async t => {
  const f = await fixture(t, { policy: policy() });
  await f.session.prompt("First assignment");
  const old = state(f);
  await f.session.prompt("/vmodel reselect");
  f.runtime.registerProvider("fixture", { ...f.provider, classifiers: { "fixture-classify": { async classify() {
    return { api: "fixture-classify", provider: "fixture", model: "judge", timestamp: Date.now(), stopReason: "stop", answers: { route: { type: "choice", choice: "__abstain__", confidence: 1, probabilities: { __abstain__: 1 } } } };
  } } } });
  await f.session.prompt("Ambiguous new work");
  await assert.rejects(f.runtime.resolveModel(f.session.model!, [], { reason: "direct", thinkingLevel: "off" }), error("NO_ASSIGNMENT"));
  const messages = f.manager.buildSessionProjection().messages.filter(m => m.role === "user");
  await assert.rejects(f.runtime.resolveModel(f.session.model!, messages, { reason: "retry", thinkingLevel: "off", state: old }), error("ABSTAINED"));
  assert.equal(f.calls.length, 1);
});

test("tool selection and preview do not inherit native context or affinity and cannot replace its pin", async t => {
  const f = await fixture(t, { policy: policy() });
  await f.session.prompt("PRIVATE_NATIVE_TASK");
  const id = state(f).assignment.decisionId;
  const tool = f.session.getToolDefinition("virtual_models")!;
  const ctx = { ...f.ctx, tools: [], executeTool: async () => { throw new Error("no nested tools"); } } as ExtensionToolContext;
  await tool.execute("test", { action: "select", selection: "virt/auto:low", state: { task: "INDEPENDENT_TOOL_TASK" } }, undefined, undefined, ctx);
  assert.deepEqual((f.classified.at(-1) as ClassifierRequest).state, { task: "INDEPENDENT_TOOL_TASK" });
  await f.session.prompt("/vmodel preview --allow-inference virt/auto:low -- INDEPENDENT_PREVIEW_TASK");
  assert.deepEqual((f.classified.at(-1) as ClassifierRequest).state, { task: "INDEPENDENT_PREVIEW_TASK", taskTruncated: false, hasImages: false });
  assert.equal(state(f).assignment.decisionId, id);
  await f.session.prompt("Continue");
  assert.equal(f.classified.length, 3);
  assert.equal(state(f).assignment.decisionId, id);
});

test("compacted-away and synthetic context is not recovered for the next selection", async t => {
  const f = await fixture(t, { policy: policy("turn") });
  await f.session.prompt("COMPACTED_SECRET: " + "old evidence ".repeat(1000));
  await f.session.prompt("Recent task. " + "Recent evidence. ".repeat(100));
  await f.session.compact();
  await f.session.prompt("Continue after compaction");
  const latest = f.classified.at(-1) as ClassifierRequest;
  assert.equal(latest.state.task, "Continue after compaction");
  assert(!JSON.stringify(latest).includes("COMPACTED_SECRET"));
  assert(!JSON.stringify(latest).includes(EXECUTION_CONTEXT_TYPE));
});

for (const mutation of ["epoch", "branch", "session"]) test(`late native results cannot dispatch or publish after ${mutation} changes`, async t => {
  const f = await fixture(t, { policy: policy("turn") });
  await f.session.prompt("Initial work");
  const base = f.provider.classifiers!["fixture-classify"]!;
  f.runtime.registerProvider("fixture", { ...f.provider, classifiers: { "fixture-classify": { async classify(model, request, options) {
    if (mutation === "epoch") f.manager.appendCustomEntry(RESELECT_TYPE, { version: 1, selection: "virt/auto:high" });
    else if (mutation === "session") f.manager.newSession();
    else f.manager.branch(f.manager.getBranch().find(e => e.type === "message" && e.message.role === "user")!.id);
    return base.classify(model, request, options);
  } } } });
  const notices: unknown[] = [], receipts: unknown[] = [], usage: unknown[] = [];
  const def = createVirtualDefinitions(policy("turn"), v => usage.push(v), v => notices.push(v), v => receipts.push(v)).find(d => d.provider === "virt" && d.id === "auto/high")!;
  const messages = f.manager.buildSessionProjection().messages.filter(m => m.role === "user");
  await assert.rejects(async () => def.route({ model: f.session.model!, reason: "user", thinkingLevel: "off", messages }, f.ctx), error("STALE_DECISION"));
  assert.equal(notices.length, 0);
  assert.equal(receipts.length, 0);
  assert.equal(usage.length, 0);
});
