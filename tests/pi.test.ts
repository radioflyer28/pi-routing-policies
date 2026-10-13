import assert from "node:assert/strict";
import { test } from "node:test";
import { createVirtualDefinitions, nativeEntries } from "../src/pi-adapter.ts";
import { RoutingError } from "../src/core/index.ts";
import { config } from "./fixtures.ts";
import { fixture } from "./sdk-fixture.ts";
const error = (code: string) => (e: unknown) => e instanceof RoutingError && e.code === code;

test("native identities preserve bare auto, explicit effort and role defaults", () => {
  const entries = nativeEntries(config());
  for (const [selection, id] of [["virt/auto", "auto"], ["virt/auto:medium", "auto/medium"], ["wiki/edit", "edit"], ["wiki/edit:high", "edit/high"]]) {
    assert.equal(entries.find(e => e.selection === selection)?.id, id);
  }
  assert.equal(new Set(entries.map(e => `${e.provider}/${e.id}`)).size, entries.length);
});

test("real SDK startup selects queued virtual model and dispatches physical model with classifier usage", async t => {
  const f = await fixture(t);
  assert.equal(f.session.model?.provider, "virt");
  assert.equal(f.session.model?.id, "auto/high");
  await f.session.prompt("Reconcile conflicting wiki sources.");
  assert.equal(f.session.getLastAssistantText(), "fixture response");
  assert.equal(f.classified.length, 1);
  assert.equal(f.calls[0]?.model, "large");
  assert.equal(f.calls[0]?.thinking, "medium");
  assert.equal(f.session.model?.id, "auto/high");
  const assistant = f.session.messages.findLast(m => m.role === "assistant");
  assert.equal(assistant?.provider, "fixture");
  assert.equal(assistant?.model, "large");
  const usage = f.manager.getBranch().find(e => e.type === "custom" && e.customType === "virtual-models.selector-usage");
  assert(usage?.type === "custom");
  assert.equal((usage.data as { totalTokens: number }).totalTokens, 11);
  assert(!JSON.stringify(usage).includes("conflicting wiki"));
});

test("tool continuations stay sticky and new user turns classify again", async t => {
  const f = await fixture(t, { toolTurn: true });
  await f.session.prompt("Reconcile sources, then continue.");
  assert.equal(f.calls.length, 2);
  assert.equal(f.classified.length, 1);
  assert(f.calls.every(c => c.model === "large"));
  await f.session.prompt("A new wiki task.");
  assert.equal(f.classified.length, 2);
});

test("manual command pins explicit selection without classifier calls and can restore auto", async t => {
  const f = await fixture(t);
  await f.session.prompt("/virtual-model wiki/edit:low");
  assert.equal(f.session.model?.id, "edit/low");
  await f.session.prompt("Mechanical update.");
  await f.session.prompt("Another mechanical update.");
  assert.equal(f.classified.length, 0);
  assert(f.calls.every(c => c.model === "small"));
  await f.session.prompt("/virtual-model virt/auto:high");
  await f.session.prompt("Complex source reconciliation.");
  assert.equal(f.classified.length, 1);
  assert.equal(f.calls.at(-1)?.model, "large");
});

test("Pi clamps physical thinking without changing virtual effort", async t => {
  const f = await fixture(t, { selection: "wiki/edit" });
  await f.session.prompt("Ordinary wiki update.");
  assert.equal(f.calls[0]?.model, "small");
  assert.equal(f.calls[0]?.thinking, undefined);
  assert.equal(f.classified.length, 0);
  assert.equal(f.session.model?.id, "edit");
});

test("direct routes recover the branch assignment without classification, and retry stays sticky", async t => {
  const f = await fixture(t);
  await f.session.prompt("Reconcile sources.");
  const model = f.session.model!;
  const direct = await f.runtime.resolveModel(model, [], { reason: "direct", thinkingLevel: "off" });
  assert.equal(direct.model.id, "large");
  assert.equal(direct.state, undefined);
  assert.equal(f.classified.length, 1);
  const entry = f.manager.getBranch().findLast(e => e.type === "custom" && e.customType === "pi.virtual-model-state");
  assert(entry?.type === "custom");
  const state = (entry.data as { state: unknown }).state;
  const retry = await f.runtime.resolveModel(model, [], { reason: "retry", thinkingLevel: "off", state });
  assert.equal(retry.model.id, "large");
  assert.equal(f.classified.length, 1);
});

test("direct requests without assignment fail closed or use an explicit direct target", async t => {
  const f = await fixture(t);
  await assert.rejects(f.runtime.resolveModel(f.session.model!, [], { reason: "direct", thinkingLevel: "off" }), error("NO_ASSIGNMENT"));
  const configured = { ...config(), direct: { provider: "fixture", model: "large", thinking: "high" as const } };
  const def = createVirtualDefinitions(configured).find(d => d.provider === "virt" && d.id === "auto")!;
  const result = await def.route({ model: f.session.model!, messages: [], reason: "direct", thinkingLevel: "off" }, f.ctx);
  assert.equal(result.model.id, "large"); assert.equal(result.thinkingLevel, "high");
  assert.equal(f.classified.length, 0);
});

test("a selection change invalidates unrelated branch state; revoked targets cannot stay sticky", async t => {
  const f = await fixture(t);
  await f.session.prompt("Reconcile sources.");
  await f.session.prompt("/virtual-model virt/auto:low");
  await assert.rejects(f.runtime.resolveModel(f.session.model!, [], { reason: "direct", thinkingLevel: "off" }), error("NO_ASSIGNMENT"));
  await f.session.prompt("Mechanical update.");
  assert.equal(f.calls.at(-1)?.model, "small");
  f.runtime.unregisterProvider("fixture");
  await assert.rejects(f.runtime.resolveModel(f.session.model!, [], { reason: "direct", thinkingLevel: "off" }), error("INELIGIBLE"));
});

test("image inputs cannot be routed to a text-only explicit target", async t => {
  const f = await fixture(t, { selection: "wiki/edit/low" });
  await assert.rejects(f.runtime.resolveModel(f.session.model!, [{ role: "user", timestamp: Date.now(), content: [{ type: "image", data: "AA==", mimeType: "image/png" }] }], { reason: "user", thinkingLevel: "off" }), error("INELIGIBLE"));
  assert.equal(f.calls.length, 0);
});

test("a failed new-turn classifier cannot silently reuse the previous task on retry", async t => {
  const f = await fixture(t);
  await f.session.prompt("First task succeeds.");
  const entry = f.manager.getBranch().findLast(e => e.type === "custom" && e.customType === "pi.virtual-model-state");
  assert(entry?.type === "custom");
  const oldState = (entry.data as { state: unknown }).state;
  f.runtime.registerProvider("fixture", { ...f.provider, classifiers: { "fixture-classify": { async classify() {
    return { api: "fixture-classify", provider: "fixture", model: "judge", timestamp: Date.now(), stopReason: "error", answers: {}, errorMessage: "fixture failure" };
  } } } });
  await f.session.prompt("A different task whose classification fails.");
  const messages = f.session.messages.filter(m => m.role === "user");
  await assert.rejects(f.runtime.resolveModel(f.session.model!, messages, { reason: "retry", thinkingLevel: "off", state: oldState }), error("SELECTOR_ERROR"));
  assert.equal(f.calls.length, 1);
});

test("actual compaction uses the chosen physical model without reclassification", async t => {
  const f = await fixture(t);
  await f.session.prompt("Reconcile sources. " + "Source evidence. ".repeat(1000));
  await f.session.prompt("A second source question. " + "Additional evidence. ".repeat(100));
  const before = f.classified.length;
  await f.session.compact();
  assert.equal(f.classified.length, before);
  assert(f.manager.getBranch().some(e => e.type === "compaction"));
  const direct = await f.runtime.resolveModel(f.session.model!, [], { reason: "direct", thinkingLevel: "off" });
  assert.equal(direct.model.id, "large");
});

test("reload preserves assignment when unchanged and rejects revoked policy before direct dispatch", async t => {
  const raw = JSON.parse(JSON.stringify(config()));
  const f = await fixture(t, { policy: raw });
  await f.session.prompt("Reconcile sources.");
  await f.session.reload();
  const route = await f.runtime.resolveModel(f.session.model!, [], { reason: "direct", thinkingLevel: "off" });
  assert.equal(route.model.id, "large");
  raw.models["wiki/edit"].efforts.high.thinking = "high";
  await f.session.reload();
  await assert.rejects(f.runtime.resolveModel(f.session.model!, [], { reason: "direct", thinkingLevel: "off" }), error("STALE_DECISION"));
  await f.session.prompt("A new task after the policy revision.");
  assert.equal(f.calls.at(-1)?.thinking, "high");
});

test("forked branch restores its own selection and assignment, not an abandoned branch", async t => {
  const first = await fixture(t);
  await first.session.prompt("Reconcile sources.");
  const highLeaf = first.manager.getLeafId()!;
  await first.session.prompt("/virtual-model virt/auto:low");
  await first.session.prompt("Mechanical work.");
  first.session.dispose();
  first.manager.createBranchedSession(highLeaf);
  const fork = await fixture(t, { manager: first.manager });
  assert.equal(fork.session.model?.id, "auto/high");
  const route = await fork.runtime.resolveModel(fork.session.model!, [], { reason: "direct", thinkingLevel: "off" });
  assert.equal(route.model.id, "large");
  assert.equal(fork.classified.length, 0);
});

test("SDK resume restores selected auto effort and direct assignment without reclassifying", async t => {
  const first = await fixture(t);
  await first.session.prompt("Reconcile sources.");
  first.session.dispose();
  const resumed = await fixture(t, { manager: first.manager });
  assert.equal(resumed.session.model?.id, "auto/high");
  const direct = await resumed.runtime.resolveModel(resumed.session.model!, [], { reason: "direct", thinkingLevel: "off" });
  assert.equal(direct.model.id, "large");
  assert.equal(resumed.classified.length, 0);
});
