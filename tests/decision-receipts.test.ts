import assert from "node:assert/strict";
import { test } from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionToolContext, Theme } from "@earendil-works/pi-coding-agent";
import { createRouter, RoutingError } from "../src/core/index.ts";
import type { DecisionReceipt, PolicyConfig, Selector } from "../src/core/index.ts";
import { DECISION_RECEIPT_TYPE, receiptFromEntry, renderDecisionFailure, summarizeSelectorAttempts } from "../src/decision-notice.ts";
import { piInventory } from "../src/pi-adapter.ts";
import { config, answer, available } from "./fixtures.ts";
import { fixture, zeroCost } from "./sdk-fixture.ts";

const error = (code: string) => (e: unknown) => e instanceof RoutingError && e.code === code;
const choose = (choice: string, metadata?: Record<string, unknown>): Selector => ({ async select() { return { answer: answer(choice), metadata }; } });
initTheme("dark", false);
const theme = { fg: (_color: string, text: string) => text } as Theme;

test("receipts explain scope/effort/allowlist/inventory exclusions without persisting task or prose", async () => {
  const receipts: DecisionReceipt[] = [];
  const input: PolicyConfig = { ...config(), namespaces: { wiki: {} }, models: {
    ...config().models, "wiki/edit": { ...config().models["wiki/edit"]!, instructions: "PRIVATE_GUIDANCE" },
  } };
  const router = createRouter(input, target => target.model === "large" ? { eligible: false, code: "auth_missing", reason: "PRIVATE_CREDENTIAL" } : available(), { onReceipt: r => { receipts.push(r); } });
  await assert.rejects(router.select("wiki/auto:high", { task: "PRIVATE_TASK" }, choose("wiki/edit:high")), error("NO_CANDIDATES"));
  assert.equal(receipts.length, 1);
  const r = receipts[0]!;
  assert.equal(r.outcome, "error");
  assert.equal(r.selector.invoked, false);
  assert.deepEqual(r.selector.usage, { totalTokens: null, cost: null });
  assert.equal(r.candidates.find(c => c.choice === "wiki/edit:high")?.reason, "auth_missing");
  assert.equal(r.candidates.find(c => c.choice === "wiki/edit:low")?.reason, "effort");
  assert.equal(r.candidates.find(c => c.choice === "code/review:high")?.reason, "namespace");
  assert.equal(r.candidates.length, 6);
  assert(!JSON.stringify(r).includes("PRIVATE"));
  const decision = await router.prepare("virt/auto", {}, { allowedChoices: ["wiki/edit:low"] });
  assert.equal(receipts.at(-1)?.candidates.find(c => c.choice === "wiki/edit:medium")?.reason, "not_allowed");
  const assigned = await router.accept(decision, answer("wiki/edit:low"));
  assert.equal(assigned.instructions, "PRIVATE_GUIDANCE");
  assert.equal(receipts.at(-1)?.operation, "accept");
  assert.equal(receipts.at(-1)?.candidates.length, 6);
  assert(!JSON.stringify(receipts).includes("PRIVATE"));
});

test("one terminal receipt per public call preserves known zero usage and does not enter assignments", async () => {
  const receipts: DecisionReceipt[] = [];
  const router = createRouter(config(), available, { onReceipt: r => { receipts.push(r); } });
  const result = await router.select("virt/auto:high", { task: "PRIVATE_TASK" }, choose("wiki/edit:high", { raw: "PRIVATE_RAW", usage: { totalTokens: 9, cost: { total: 0 } } }));
  assert.equal(receipts.length, 1);
  const r = receipts[0]!;
  assert.equal(r.operation, "select");
  assert.equal(r.outcome, "assigned");
  assert.equal(r.decisionId, result.assignment.decisionId);
  assert.deepEqual(r.assignment, { choice: result.assignment.choice, target: result.assignment.target });
  assert.equal(r.selector.outcome, "returned");
  assert.deepEqual(r.selector.usage, { totalTokens: 9, cost: 0 });
  assert(!JSON.stringify(r).includes("PRIVATE"));
  assert(!Object.hasOwn(result.assignment, "receipt"));
  assert(Object.isFrozen(r) && Object.isFrozen(r.candidates) && Object.isFrozen(r.selector.usage));
  assert.throws(() => { (r.candidates as unknown[]).push({}); }, TypeError);
  await router.resolve("wiki/edit:high");
  await router.revalidate(result.assignment);
  assert.equal(receipts.length, 3);
  assert(receipts.slice(1).every(value => !value.selector.invoked));
});

test("receipt preserves an observed response when acceptance fails or a target is revoked", async () => {
  const receipts: DecisionReceipt[] = [];
  let revoked = false;
  const router = createRouter(config(), () => revoked ? { eligible: false, code: "restricted" } : available(), { onReceipt: r => { receipts.push(r); } });
  const metadata = { usage: { totalTokens: 12, cost: { total: 0.02 } } };
  await assert.rejects(router.select("virt/auto:high", {}, choose("PRIVATE_UNOFFERED", metadata)), error("INVALID_ANSWER"));
  assert.equal(receipts[0]?.selector.outcome, "returned");
  assert.equal(receipts[0]?.selector.usage.cost, 0.02);
  assert(!JSON.stringify(receipts[0]).includes("PRIVATE_UNOFFERED"));
  await assert.rejects(router.select("virt/auto:high", {}, { async select() { revoked = true; return { answer: answer("wiki/edit:high"), metadata }; } }), error("INELIGIBLE"));
  assert.deepEqual(receipts.at(-1)?.candidates.find(c => c.choice === "wiki/edit:high"), { choice: "wiki/edit:high", eligible: false, stage: "recheck", reason: "restricted" });
  assert.equal(receipts.at(-1)?.assignment, undefined);
});

test("abstention, unavailable selector, timeout and cancellation have distinct receipts and unknown costs", async () => {
  const receipts: DecisionReceipt[] = [];
  const router = createRouter(config(), available, { onReceipt: r => { receipts.push(r); } });
  await assert.rejects(router.select("virt/auto", {}, choose("__abstain__")), error("ABSTAINED"));
  await assert.rejects(router.select("virt/auto", {}), error("SELECTOR_UNAVAILABLE"));
  for (const code of ["SELECTOR_TIMEOUT", "ABORTED", "SELECTOR_UNAVAILABLE"] as const) {
    await assert.rejects(router.select("virt/auto", {}, { async select() { throw new RoutingError(code, "PRIVATE_ERROR"); } }), error(code));
  }
  assert.deepEqual(receipts.map(r => r.outcome), ["abstained", "error", "error", "aborted", "error"]);
  assert.deepEqual(receipts.map(r => r.selector.outcome), ["returned", "not_invoked", "timeout", "aborted", "unavailable"]);
  assert(receipts.every(r => r.selector.usage.cost === null));
  assert(!JSON.stringify(receipts).includes("PRIVATE"));
  const totals = summarizeSelectorAttempts(receipts);
  assert.equal(totals.invocations, 4);
  assert.equal(totals.timedOut, 1);
  assert.equal(totals.unknownCostInvocations, 4);
});

test("receipt observation is isolated, concurrent calls remain correctly attributed", async () => {
  const throwing = createRouter(config(), available, { onReceipt() { throw new Error("PRIVATE_OBSERVER"); } });
  assert.equal((await throwing.resolve("wiki/edit:high")).choice, "wiki/edit:high");
  await assert.rejects(throwing.select("virt/auto", {}, choose("__abstain__")), error("ABSTAINED"));
  const asynchronous = createRouter(config(), available, { onReceipt: async () => { throw new Error("PRIVATE_ASYNC_OBSERVER"); } });
  await asynchronous.resolve("wiki/edit:high");
  await new Promise(resolve => setImmediate(resolve));
  const receipts: DecisionReceipt[] = [];
  const router = createRouter(config(), available, { onReceipt: r => { receipts.push(r); } });
  let release!: () => void;
  const first = router.select("virt/auto:high", {}, { async select() { await new Promise<void>(r => { release = r; }); return { answer: answer("wiki/edit:high"), metadata: { usage: { totalTokens: 10 } } }; } });
  await new Promise(resolve => setImmediate(resolve));
  await router.select("virt/auto:low", {}, choose("code/review:low", { usage: { totalTokens: 20 } }));
  release(); await first;
  assert.deepEqual(receipts.map(r => [r.selection, r.selector.usage.totalTokens]), [["virt/auto:low", 20], ["virt/auto:high", 10]]);
  assert.notEqual(receipts[0]?.id, receipts[1]?.id);
});

test("untrusted error/reason/selection metadata is not persisted; undefined rejection is an error", async () => {
  const receipts: DecisionReceipt[] = [];
  const router = createRouter(config(), () => ({ eligible: false, reason: "PRIVATE_REASON" }), { onReceipt: r => { receipts.push(r); } });
  await assert.rejects(router.resolve("wiki/edit:high"), error("INELIGIBLE"));
  assert.equal(receipts[0]?.candidates[0]?.reason, "inventory_rejected");
  await assert.rejects(router.resolve("PRIVATE_INVALID_SELECTION"), error("INVALID_SELECTION"));
  assert.equal(receipts[1]?.selection, null);
  const other = createRouter(config(), available, { onReceipt: r => { receipts.push(r); } });
  await assert.rejects(other.select("virt/auto", {}, { async select() { throw undefined; } }));
  assert.equal(receipts.at(-1)?.errorCode, "INTERNAL_ERROR");
  assert.equal(receipts.at(-1)?.outcome, "error");
  await other.select("virt/auto", {}, choose("wiki/edit:low", { usage: { totalTokens: Infinity, cost: { total: -1 } } }));
  assert.deepEqual(receipts.at(-1)?.selector.usage, { totalTokens: null, cost: null });
  assert(!JSON.stringify(receipts).includes("PRIVATE"));
});

test("maximum policy catalog still produces a bounded receipt without policy prose", async () => {
  const roles: Record<string, PolicyConfig["models"][string]> = {};
  const criteria: Record<string, string> = { __abstain__: "No fit" };
  for (let i = 0; i < 64; i++) {
    const role = `${"n".repeat(48)}/${`role-${i}`.padEnd(48, "r")}`;
    roles[role] = { defaultEffort: "medium", efforts: {
      low: { provider: "fixture", model: "small", thinking: "off" },
      medium: { provider: "fixture", model: "small", thinking: "low" },
      high: { provider: "fixture", model: "large", thinking: "high" },
    } };
    for (const effort of ["low", "medium", "high"]) criteria[`${role}:${effort}`] = "PRIVATE_CRITERION";
  }
  let receipt: DecisionReceipt | undefined;
  const router = createRouter({ version: 1, models: roles, questions: { route: { type: "choice", instructions: "PRIVATE_POLICY", criteria } } }, () => ({ eligible: true, capacity: { contextWindow: 1000000000, maxOutputTokens: 1000000000 } }), { onReceipt: r => { receipt = r; } });
  await router.prepare("virt/auto:high", { task: "PRIVATE_TASK" });
  assert(receipt);
  assert.equal(receipt.candidates.length, 192);
  assert(Buffer.byteLength(JSON.stringify(receipt), "utf8") < 65_536);
  assert(!JSON.stringify(receipt).includes("PRIVATE"));
  await router.prepare("virt/auto", { task: "PRIVATE_TASK" }, { capacity: { mode: "require-estimated-fit", inputTokens: 0, outputReserveTokens: 1000000000, estimateSource: "caller" } });
  assert.equal(receipt.candidates.length, 192);
  assert(receipt.candidates.every(c => c.capacity?.status === "estimated_fit"));
  assert(Buffer.byteLength(JSON.stringify(receipt), "utf8") < 65_536);
  assert(!JSON.stringify(receipt).includes("PRIVATE"));
});

test("native decisions persist outside execution context and successes do not add duplicate notices", async t => {
  const f = await fixture(t, { toolTurn: true });
  await f.session.prompt("PRIVATE_USER_TASK");
  const entries = f.manager.getBranch().filter(e => e.type === "custom" && e.customType === DECISION_RECEIPT_TYPE);
  const receipts = entries.map(e => e.type === "custom" ? receiptFromEntry(e.data)! : undefined).filter(r => r !== undefined);
  assert.equal(receipts.length, 2); // selection + continuation revalidation
  assert.equal(summarizeSelectorAttempts(receipts).invocations, 1);
  assert.equal(summarizeSelectorAttempts(receipts).reportedTokens, 11);
  assert(!JSON.stringify(receipts).includes("PRIVATE_USER_TASK"));
  assert(!JSON.stringify(f.executionContexts).includes(DECISION_RECEIPT_TYPE));
  assert(!JSON.stringify(f.executionContexts).includes("Candidates:"));
  const renderer = f.loader.getExtensions().extensions.find(e => e.entryRenderers?.has(DECISION_RECEIPT_TYPE))!.entryRenderers!.get(DECISION_RECEIPT_TYPE)!;
  const first = entries[0]!;
  assert(first.type === "custom");
  assert.equal(renderer(first, { expanded: false }, theme), undefined);
});

test("native failure has expandable reason/unknown-cost diagnostics without dispatch", async t => {
  const f = await fixture(t);
  f.runtime.registerProvider("fixture", { ...f.provider, classifiers: { "fixture-classify": { async classify() {
    return { api: "fixture-classify", provider: "fixture", model: "judge", timestamp: Date.now(), stopReason: "error", answers: {}, errorMessage: "PRIVATE_PROVIDER_ERROR" };
  } } } });
  await f.session.prompt("PRIVATE_TASK");
  const entry = f.manager.getBranch().findLast(e => e.type === "custom" && e.customType === DECISION_RECEIPT_TYPE)!;
  assert(entry.type === "custom");
  const receipt = receiptFromEntry(entry.data)!;
  assert.equal(receipt.errorCode, "SELECTOR_ERROR");
  assert.equal(receipt.selector.usage.cost, null);
  assert.equal(f.calls.length, 0);
  const collapsed = renderDecisionFailure(receipt, false, theme).render(160).join("\n");
  const expanded = renderDecisionFailure(receipt, true, theme).render(160).join("\n");
  assert(collapsed.includes("SELECTOR_ERROR"));
  assert(expanded.includes("cost: unknown"));
  assert(expanded.includes("Excluded:"));
  assert(!JSON.stringify(entry).includes("PRIVATE"));
});

test("classifier failure usage and invocation status are available without rerunning selection", async t => {
  const f = await fixture(t);
  f.runtime.registerProvider("fixture", { ...f.provider, classifiers: { "fixture-classify": { async classify() {
    return { api: "fixture-classify", provider: "fixture", model: "judge", timestamp: Date.now(), stopReason: "error", answers: {}, errorMessage: "PRIVATE_ERROR",
      usage: { input: 6, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 7, cost: { ...zeroCost, total: 0.03 } } };
  } } } });
  await f.session.prompt("PRIVATE_TASK");
  await f.session.prompt("/vmodel");
  const entry = f.manager.getBranch().findLast(e => e.type === "custom" && e.customType === "virtual-models.diagnostic");
  assert(entry?.type === "custom");
  const status = (entry.data as any).report;
  assert.equal(status.selectorAttempts.invocations, 1);
  assert.equal(status.selectorAttempts.failedDecisions, 1);
  assert.equal(status.selectorAttempts.reportedTokens, 7);
  assert.equal(status.selectorAttempts.reportedCost, 0.03);
  assert.equal(status.selectorAttempts.unknownCostInvocations, 0);
  assert.equal(f.calls.length, 0);
});

test("direct failures before core resolution are recorded without a selector invocation", async t => {
  const f = await fixture(t);
  await assert.rejects(f.runtime.resolveModel(f.session.model!, [], { reason: "direct", thinkingLevel: "off" }), error("NO_ASSIGNMENT"));
  const entry = f.manager.getBranch().findLast(e => e.type === "custom" && e.customType === DECISION_RECEIPT_TYPE);
  assert(entry?.type === "custom");
  const receipt = receiptFromEntry(entry.data)!;
  assert.equal(receipt.operation, "route");
  assert.equal(receipt.selector.invoked, false);
  assert.equal(receipt.errorCode, "NO_ASSIGNMENT");
});

test("post-resolution dispatch failure has a correlated route receipt with full elapsed time", async t => {
  const f = await fixture(t, { selection: "wiki/edit/high" });
  const registry = f.ctx.modelRegistry;
  const original = registry.hasConfiguredAuth.bind(registry);
  let checks = 0;
  registry.hasConfiguredAuth = model => model.provider === "fixture" && model.id === "large" ? ++checks === 1 : original(model);
  try {
    await assert.rejects(f.runtime.resolveModel(f.session.model!, [], { reason: "direct", thinkingLevel: "off" }), error("INELIGIBLE"));
  } finally { registry.hasConfiguredAuth = original; }
  const receipts = f.manager.getBranch().filter(e => e.type === "custom" && e.customType === DECISION_RECEIPT_TYPE).map(e => e.type === "custom" ? receiptFromEntry(e.data)! : undefined).filter(r => r !== undefined);
  assert.equal(receipts.length, 2);
  const [resolved, failed] = receipts as [DecisionReceipt, DecisionReceipt];
  assert.equal(resolved.outcome, "assigned");
  assert.equal(failed.operation, "route");
  assert.equal(failed.errorCode, "INELIGIBLE");
  assert.equal(failed.decisionId, resolved.decisionId);
  assert(failed.startedAt <= resolved.startedAt);
  assert(failed.durationMs >= resolved.durationMs);
  assert.equal(f.calls.length, 0);
});

test("tool records remain diagnostic-only and native inventory gives stable failure codes", async t => {
  const f = await fixture(t);
  const ctx: ExtensionToolContext = { ...f.ctx, tools: [], executeTool: async () => { throw new Error("no nested calls"); } };
  const initial = f.session.model;
  const tool = f.session.getToolDefinition("virtual_models")!;
  const result = await tool.execute("receipt-test", { action: "select", state: { task: "PRIVATE_TOOL_TASK" }, selection: "virt/auto:high" }, undefined, undefined, ctx);
  assert.equal(f.session.model, initial);
  const content = JSON.stringify(result.content);
  assert(!content.includes("candidates") && !content.includes("receipt") && !content.includes("judge"));
  const entries = f.manager.getBranch().filter(e => e.type === "custom" && e.customType === DECISION_RECEIPT_TYPE);
  assert.equal(entries.length, 1);
  assert(!JSON.stringify(entries).includes("PRIVATE"));
  const inventory = piInventory(f.ctx);
  assert.equal((await inventory({ provider: "fixture", model: "absent", thinking: "off" }, ["text"])).code, "model_missing");
  assert.equal((await inventory({ provider: "virt", model: "auto", thinking: "off" }, ["text"])).code, "not_physical");
  assert.equal((await inventory({ provider: "fixture", model: "small", thinking: "off" }, ["image"])).code, "input_unsupported");
});
