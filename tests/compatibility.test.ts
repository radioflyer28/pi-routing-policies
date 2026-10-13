import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import type { ExtensionError } from "@earendil-works/pi-coding-agent";
import type { ClassifierRequest, DecisionReceipt, PolicyConfig } from "../src/core/index.ts";
import type { RouteState } from "../src/pi-adapter.ts";
import { DECISION_RECEIPT_TYPE } from "../src/decision-notice.ts";
import { EXECUTION_CONTEXT_TYPE } from "../src/execution-context.ts";
import { ROUTING_NOTICE_TYPE } from "../src/routing-notice.ts";
import { config } from "./fixtures.ts";
import { fixture } from "./sdk-fixture.ts";

test("host interoperability suite uses the pinned Pi 1.2.0 development packages", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  for (const name of ["pi-coding-agent", "pi-ai", "pi-tui"]) {
    const id = `@earendil-works/${name}`;
    const installed = JSON.parse(await readFile(new URL(`../node_modules/${id}/package.json`, import.meta.url), "utf8"));
    assert.equal(manifest.devDependencies[id], "1.2.0", `${id}: update this guard when reviewing a new host baseline`);
    assert.equal(installed.version, manifest.devDependencies[id], `${id}: run npm ci to use the declared baseline`);
  }
});

function state(f: Awaited<ReturnType<typeof fixture>>): RouteState {
  const entry = f.manager.getBranch().findLast(e => e.type === "custom" && e.customType === "pi.virtual-model-state");
  assert(entry?.type === "custom");
  return (entry.data as { state: RouteState }).state;
}
function receipt(f: Awaited<ReturnType<typeof fixture>>): DecisionReceipt {
  const entry = f.manager.getBranch().findLast(e => e.type === "custom" && e.customType === DECISION_RECEIPT_TYPE);
  assert(entry?.type === "custom");
  return (entry.data as { receipt: DecisionReceipt }).receipt;
}
function policy(kind: "classifier" | "llm" = "classifier"): PolicyConfig {
  const p = config();
  return { ...p, nativeRouting: { context: { includeAssistant: true } }, routingContext: "assignment",
    models: { ...p.models, "wiki/edit": { ...p.models["wiki/edit"]!, instructions: "PRIVATE_ROLE_GUIDANCE" } },
    ...(kind === "llm" ? { selector: { kind, provider: "fixture", model: "judge-llm", thinking: "off" } } : {}) };
}

for (const kind of ["classifier", "llm"] as const) test(`${kind}: extension-triggered runs reuse the user assignment without sharing custom messages`, async t => {
  const starts: { type: string; idle: boolean }[] = [];
  const f = await fixture(t, { policy: policy(kind), configure(pi) {
    pi.on("before_agent_start", (event, ctx) => {
      starts.push({ type: event.messageType, idle: ctx.isIdle() });
      if (event.messageType === "custom") assert.equal(event.message.customType, "fixture-trigger");
    });
  } });
  const errors: ExtensionError[] = [];
  t.after(f.session.extensionRunner!.onError(e => errors.push(e)));
  await f.session.prompt("USER_TASK: reconcile sources");
  const pin = state(f).assignment.decisionId;
  const notices = f.manager.getBranch().filter(e => e.type === "custom" && e.customType === ROUTING_NOTICE_TYPE).length;
  f.api.sendMessage({ customType: "fixture-trigger", content: "PRIVATE_CUSTOM_TRIGGER", display: false }, { triggerTurn: true });
  await f.session.waitForIdle();
  assert.deepEqual(errors, []);
  assert.deepEqual(starts, [{ type: "user", idle: false }, { type: "custom", idle: false }]);
  assert.equal(f.calls.length, 2);
  assert.equal(f.classified.length + f.llmSelections.length, 1);
  assert.equal(state(f).assignment.decisionId, pin);
  assert.equal(f.manager.getBranch().filter(e => e.type === "custom" && e.customType === ROUTING_NOTICE_TYPE).length, notices);
  assert(f.executionContexts.every(messages => messages.filter(m => m.role === "user" && JSON.stringify(m.content).includes("PRIVATE_ROLE_GUIDANCE")).length === 1));
  assert(JSON.stringify(f.executionContexts.at(-1)).includes("PRIVATE_CUSTOM_TRIGGER"));
  await f.session.prompt("Now review the updated sources");
  const requests = kind === "llm" ? f.llmSelections.map(s => s.request) : f.classified as ClassifierRequest[];
  assert.equal(requests.length, 2);
  assert.equal(requests[1]!.state.task, "Now review the updated sources");
  assert(!JSON.stringify(requests).includes("PRIVATE_"));
  const diagnostics = f.manager.getBranch().filter(e => e.type === "custom" && e.customType !== "pi.virtual-model-state");
  assert(!JSON.stringify(diagnostics).includes("PRIVATE_CUSTOM_TRIGGER"));
});

test("custom startup preserves other extensions' prompt sections, queued messages and role guidance through tools", async t => {
  const starts: string[] = [];
  const f = await fixture(t, { policy: policy(), selection: "wiki/edit/high", toolTurn: true, configure(pi) {
    pi.on("before_agent_start", (event, ctx) => {
      starts.push(event.messageType);
      assert.equal(ctx.isIdle(), false);
      if (event.messageType !== "custom") return;
      event.systemPromptOptions.sections.fixture_setup = "PRIVATE_SETUP_SECTION";
      pi.sendMessage({ customType: "fixture-during-start", content: "PRIVATE_DURING_START", display: false }, { triggerTurn: true });
      return { message: { customType: "fixture-setup", content: "PRIVATE_SETUP_MESSAGE", display: false } };
    });
  } });
  const errors: ExtensionError[] = [];
  t.after(f.session.extensionRunner!.onError(e => errors.push(e)));
  f.api.sendMessage({ customType: "fixture-next", content: "PRIVATE_NEXT_TURN", display: false }, { deliverAs: "nextTurn" });
  f.api.sendMessage({ customType: "fixture-trigger", content: "PRIVATE_CUSTOM_TRIGGER", display: false }, { triggerTurn: true });
  await f.session.waitForIdle();
  assert.deepEqual(errors, []);
  assert.deepEqual(starts, ["custom"]);
  assert.equal(f.calls.length, 2);
  assert.equal(f.classified.length, 0);
  for (const messages of f.executionContexts) {
    const body = JSON.stringify(messages);
    for (const text of ["PRIVATE_SETUP_SECTION", "PRIVATE_SETUP_MESSAGE", "PRIVATE_NEXT_TURN", "PRIVATE_ROLE_GUIDANCE"]) assert(body.includes(text), text);
    assert.equal(messages.filter(m => m.role === "user" && JSON.stringify(m.content).includes("PRIVATE_ROLE_GUIDANCE")).length, 1);
  }
  assert(JSON.stringify(f.executionContexts.at(-1)).includes("PRIVATE_DURING_START"));
  assert(!f.manager.getBranch().some(e => e.type === "custom_message" && e.customType === EXECUTION_CONTEXT_TYPE));
  assert(f.calls.every(c => c.model === "large"));
});

test("custom-only automatic startup fails before inference rather than classifying synthetic task text", async t => {
  const f = await fixture(t);
  await f.session.sendCustomMessage({ customType: "fixture-trigger", content: "PRIVATE_SYNTHETIC_TASK", display: false }, { triggerTurn: true });
  assert.equal(f.classified.length, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(receipt(f).errorCode, "INVALID_STATE");
  assert(!JSON.stringify(receipt(f)).includes("PRIVATE_SYNTHETIC_TASK"));
});

test("abort during custom startup settles as aborted without selector or execution dispatch", async t => {
  const settled: boolean[] = [];
  const f = await fixture(t, { configure(pi) {
    pi.on("before_agent_start", (event, ctx) => { if (event.messageType === "custom") { assert.equal(ctx.isIdle(), false); ctx.abort(); } });
    pi.on("agent_settled", event => { settled.push(event.aborted); });
  } });
  await f.session.sendCustomMessage({ customType: "fixture-trigger", content: "Cancelled startup", display: false }, { triggerTurn: true });
  assert.deepEqual(settled, [true]);
  assert.equal(f.classified.length, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(f.ctx.isIdle(), true);
});

// Simulate credential-scoped catalog updates locally, not OpenRouter HTTP/auth behavior.
for (const kind of ["classifier", "llm"] as const) test(`${kind}: current catalog removals filter candidates before inference`, async t => {
  const f = await fixture(t, { policy: policy(kind), selection: "virt/auto" });
  f.runtime.registerProvider("fixture", { ...f.provider, models: f.provider.models!.filter(m => m.id !== "large") });
  await f.session.prompt("Choose only from the current catalog");
  const request = kind === "llm" ? f.llmSelections[0]!.request : f.classified[0] as ClassifierRequest;
  assert(!Object.keys(request.questions.route.criteria).some(choice => choice.endsWith(":high")));
  assert.equal(f.calls[0]?.model, "small");
  assert.equal(receipt(f).candidates.find(c => c.choice === "wiki/edit:high")?.reason, "model_missing");
  await f.session.prompt("/vmodel virt/auto:high");
  await f.session.prompt("A fixed effort cannot use a removed target");
  assert.equal(f.calls.length, 1);
  assert.equal(f.classified.length + f.llmSelections.length, 1);
  assert.equal(receipt(f).errorCode, "NO_CANDIDATES");
});

test("catalog removal revokes an affinity pin; doctor reports it and only deliberate reselection can replace it", async t => {
  const f = await fixture(t, { policy: { ...config(), nativeRouting: { affinity: "session" } }, selection: "virt/auto" });
  await f.session.prompt("Initial assignment");
  const id = state(f).assignment.decisionId;
  assert.equal(state(f).assignment.target.model, "large");
  f.runtime.registerProvider("fixture", { ...f.provider, models: f.provider.models!.filter(m => m.id !== "large") });
  await f.session.prompt("Continue after key-scoped availability changes");
  assert.equal(f.calls.length, 1);
  assert.equal(f.classified.length, 1);
  assert.equal(receipt(f).errorCode, "INELIGIBLE");
  assert.equal(receipt(f).candidates[0]?.reason, "model_missing");
  await f.session.prompt("/vmodel doctor wiki/edit:high");
  const diagnostic = f.manager.getBranch().findLast(e => e.type === "custom" && e.customType === "virtual-models.diagnostic");
  assert(diagnostic?.type === "custom");
  assert(JSON.stringify(diagnostic.data).includes("model_missing"));
  assert.equal(state(f).assignment.decisionId, id);
  await f.session.prompt("/vmodel reselect");
  await f.session.prompt("Choose from the new catalog");
  assert.equal(f.classified.length, 2);
  assert.equal(f.calls.at(-1)?.model, "small");
  assert.notEqual(state(f).assignment.decisionId, id);
});

for (const kind of ["classifier", "llm"] as const) test(`${kind}: catalog removal after a selector answer rejects dispatch without replacement`, async t => {
  const f = await fixture(t, { policy: policy(kind) });
  const remove = () => f.runtime.registerProvider("fixture", { ...f.provider, models: f.provider.models!.filter(m => m.id !== "large") });
  if (kind === "classifier") {
    const classifier = f.provider.classifiers!["fixture-classify"]!;
    f.runtime.registerProvider("fixture", { ...f.provider, classifiers: { "fixture-classify": { async classify(model, request, options) {
      const result = await classifier.classify(model, request, options);
      remove();
      return result;
    } } } });
  } else {
    f.runtime.registerProvider("fixture", { ...f.provider, streamSimple(model, context, options) {
      const stream = f.provider.streamSimple!(model, context, options);
      if (model.id === "judge-llm") remove();
      return stream;
    } });
  }
  await f.session.prompt("Target disappears while selection is in flight");
  assert.equal(f.classified.length + f.llmSelections.length, 1);
  assert.equal(f.calls.length, 0);
  assert.equal(receipt(f).errorCode, "INELIGIBLE");
  assert.equal(receipt(f).selector.invoked, true);
  assert.equal(receipt(f).candidates.find(c => c.choice === "wiki/edit:high")?.reason, "model_missing");
});

for (const limit of ["contextWindow", "maxTokens"] as const) test(`updated catalog ${limit} limits reject sticky assignments using current metadata`, async t => {
  const p: PolicyConfig = { ...config(), nativeRouting: { affinity: "session", capacity: { mode: "require-estimated-fit", inputEstimate: "pi-heuristic", outputReserveTokens: 512 } } };
  const f = await fixture(t, { policy: p });
  await f.session.prompt("Initial capacity fits");
  const id = state(f).assignment.decisionId;
  f.runtime.registerProvider("fixture", { ...f.provider, models: f.provider.models!.map(m => m.id === "large" ? { ...m, [limit]: limit === "contextWindow" ? 513 : 511 } : m) });
  await f.session.prompt("Continue after model limits change");
  assert.equal(f.calls.length, 1);
  assert.equal(f.classified.length, 1);
  assert.equal(state(f).assignment.decisionId, id);
  assert.equal(receipt(f).errorCode, "INELIGIBLE");
  assert.equal(receipt(f).candidates[0]?.reason, limit === "contextWindow" ? "capacity_context" : "capacity_output");
});

test("Pi compaction omits assistant thinking while preserving visible text and the physical assignment", async t => {
  const f = await fixture(t);
  await f.session.prompt("Source evidence. ".repeat(1000));
  const assistant = f.session.messages.findLast(m => m.role === "assistant");
  assert(assistant?.role === "assistant");
  f.manager.appendMessage({ ...assistant, timestamp: Date.now(), content: [
    { type: "thinking", thinking: "PRIVATE_COMPACTION_REASONING" },
    { type: "text", text: "VISIBLE_COMPACTION_EVIDENCE" },
  ] });
  await f.session.prompt("Recent evidence. ".repeat(100));
  const before = f.executionContexts.length;
  const selectors = f.classified.length;
  await f.session.compact();
  const summaries = f.executionContexts.slice(before);
  assert(summaries.length > 0);
  assert(JSON.stringify(summaries).includes("VISIBLE_COMPACTION_EVIDENCE"));
  assert(!JSON.stringify(summaries).includes("PRIVATE_COMPACTION_REASONING"));
  assert.equal(f.classified.length, selectors);
  assert.equal(f.calls.at(-1)?.model, "large");
});
