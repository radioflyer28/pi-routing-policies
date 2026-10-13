import assert from "node:assert/strict";
import { test } from "node:test";
import { assessCapacity, createRouter, parsePolicy, RoutingError } from "../src/core/index.ts";
import type { CapacityRequirement, DecisionReceipt, Inventory } from "../src/core/index.ts";
import { capacityRequirement } from "../src/core/capacity.ts";
import { answer, config } from "./fixtures.ts";
const error = (code: string) => (e: unknown) => e instanceof RoutingError && e.code === code;
const strict = (inputTokens: number | null = 80, outputReserveTokens = 20): CapacityRequirement => ({ mode: "require-estimated-fit", inputTokens, outputReserveTokens, estimateSource: "caller" });
const observed = { contextWindow: 100, maxOutputTokens: 50 };
const inventory: Inventory = target => ({ eligible: true, capacity: target.model === "small" ? observed : { contextWindow: 1000, maxOutputTokens: 500 } });

test("capacity validates strict bounded counts and enums; model zero/invalid limits stay unknown", () => {
  for (const invalid of [null, [], {}, { ...strict(), extra: "SECRET" }, { ...strict(), mode: "fallback" },
    ...[-1, 0.5, NaN, Infinity, 1000000001, "80", undefined].map(inputTokens => ({ ...strict(), inputTokens })),
    { ...strict(), outputReserveTokens: -1 }, { ...strict(), estimateSource: "SECRET_SOURCE" }, { ...strict(), estimateSource: "unknown" }]) {
    assert.throws(() => capacityRequirement(invalid), error("INVALID_SELECTION"));
  }
  assert.equal(capacityRequirement(strict(0, 0)).inputTokens, 0);
  assert(Object.isFrozen(capacityRequirement(strict())));
  for (const value of [undefined, null, 0, -1, NaN, Infinity, 0.5, 1000000001]) {
    const result = assessCapacity(strict(), { contextWindow: value, maxOutputTokens: value });
    assert.equal(result.code, "capacity_unknown");
    assert.deepEqual(result.assessment, { contextWindow: null, maxOutputTokens: null, status: "unknown" });
  }
});

test("strict capacity uses equality boundaries and distinguishes output, context and unknown", () => {
  assert.equal(assessCapacity(strict(), observed).assessment.status, "estimated_fit");
  assert.equal(assessCapacity(strict(81), observed).code, "capacity_context");
  assert.equal(assessCapacity(strict(0, 51), observed).code, "capacity_output");
  assert.equal(assessCapacity(strict(null), observed).code, "capacity_unknown");
  assert.equal(assessCapacity(strict(80), {}).code, "capacity_unknown");
  assert.equal(assessCapacity(strict(1000000000, 1000000000), { contextWindow: 1000000000, maxOutputTokens: 1000000000 }).code, "capacity_context");
});

test("allow-compaction waives only excess/unknown context, never impossible output requirements", () => {
  const allowed = (input: number | null, reserve = 20) => ({ ...strict(input, reserve), mode: "allow-compaction" as const });
  for (const input of [null, 81, 1000]) {
    const assessment = assessCapacity(allowed(input), observed);
    assert.equal(assessment.eligible, true);
    assert.equal(assessment.assessment.status, input === null ? "unknown" : "context_exceeded");
  }
  assert.equal(assessCapacity(allowed(1), { maxOutputTokens: 50 }).eligible, true);
  assert.equal(assessCapacity(allowed(1), { contextWindow: 100 }).code, "capacity_unknown");
  assert.equal(assessCapacity(allowed(0, 51), observed).code, "capacity_output");
  assert.equal(assessCapacity(allowed(null, 101), { contextWindow: 100, maxOutputTokens: 500 }).code, "capacity_context");
});

test("native capacity configuration is opt-in, immutable, strict and revisioned", () => {
  const before = parsePolicy(config());
  const valid = { mode: "allow-compaction", outputReserveTokens: 100, inputEstimate: "pi-heuristic" };
  const parsed = parsePolicy({ ...config(), nativeRouting: { capacity: valid } });
  assert.notEqual(before.revision, parsed.revision);
  assert(Object.isFrozen(parsed.config.nativeRouting?.capacity));
  for (const capacity of [false, {}, { ...valid, inputTokens: 20 }, { ...valid, outputReserveTokens: -1 }, { ...valid, mode: "upgrade" }, { ...valid, inputEstimate: "chars-per-token" }]) {
    assert.throws(() => parsePolicy({ ...config(), nativeRouting: { capacity } }), error("INVALID_CONFIG"));
  }
});

test("capacity filters before inference without widening scope, effort or allowlists", async () => {
  const receipts: DecisionReceipt[] = [];
  const p = { ...config(), namespaces: { wiki: {}, code: {} } };
  const router = createRouter(p, inventory, { onReceipt: r => receipts.push(r) });
  let calls = 0;
  const selector = { async select(request: any) {
    calls++;
    assert.deepEqual(request.state, { task: "PRIVATE_TASK" });
    assert.deepEqual(Object.keys(request.questions.route.criteria), ["wiki/edit:high", "__abstain__"]);
    assert(!JSON.stringify(request).includes("outputReserveTokens"));
    return { answer: answer("wiki/edit:high") };
  } };
  const result = await router.select("wiki/auto", { task: "PRIVATE_TASK" }, selector, { capacity: strict(100, 20), allowedChoices: ["wiki/edit:low", "wiki/edit:high"] });
  assert.equal(result.assignment.choice, "wiki/edit:high");
  assert.deepEqual(result.assignment.capacity, strict(100, 20));
  assert.equal(receipts[0]?.candidates.find(c => c.choice === "wiki/edit:low")?.reason, "capacity_context");
  assert.equal(receipts[0]?.candidates.find(c => c.choice === "code/review:high")?.reason, "namespace");
  await assert.rejects(router.select("wiki/auto:low", {}, selector, { capacity: strict(100) }), error("NO_CANDIDATES"));
  await assert.rejects(router.resolve("wiki/edit:low", { capacity: strict(100) }), error("INELIGIBLE"));
  assert.equal(calls, 1);
  assert(!JSON.stringify(receipts).includes("PRIVATE_TASK"));
});

test("prepared capacity is snapshotted and current limits are checked again after the answer", async () => {
  let window = 100;
  const router = createRouter(config(), () => ({ eligible: true, capacity: { contextWindow: window, maxOutputTokens: 50 } }));
  const mutable = { ...strict() };
  const decision = await router.prepare("virt/auto:low", {}, { capacity: mutable });
  mutable.inputTokens = 0;
  window = 99;
  await assert.rejects(router.accept(decision, answer("wiki/edit:low")), error("INELIGIBLE"));
  await assert.rejects(router.accept(decision, answer("wiki/edit:low")), error("STALE_DECISION"));
  window = 100;
  await assert.rejects(router.select("virt/auto:low", {}, { async select() { window = 0; return { answer: answer("wiki/edit:low") }; } }, { capacity: strict() }), error("INELIGIBLE"));
});

test("revalidation retains requirements, accepts fresh estimates, and never weakens mode/output reserve", async () => {
  const receipts: DecisionReceipt[] = [];
  const router = createRouter(config(), inventory, { onReceipt: r => receipts.push(r) });
  const assignment = await router.resolve("wiki/edit:low", { capacity: strict() });
  assert.deepEqual((await router.revalidate(assignment)).capacity, strict());
  const fresh = await router.revalidate(assignment, { capacity: { ...strict(10, 0), mode: "allow-compaction" } });
  assert.deepEqual(fresh.capacity, strict(10, 20));
  await assert.rejects(router.revalidate(assignment, { capacity: strict(90, 0) }), error("INELIGIBLE"));
  assert.equal(receipts.at(-1)?.capacity?.outputReserveTokens, 20);
  assert.equal(receipts.at(-1)?.candidates[0]?.reason, "capacity_context");
  await assert.rejects(router.revalidate(assignment, { capacity: strict(null) }), error("INELIGIBLE"));
});

test("unknown inventory capacity affects only opt-in callers; rejected inventory stays authoritative", async () => {
  const plain = createRouter(config(), () => ({ eligible: true }));
  const assignment = await plain.resolve("wiki/edit:low");
  assert(!("capacity" in assignment));
  await assert.rejects(plain.resolve("wiki/edit:low", { capacity: strict() }), error("INELIGIBLE"));
  let receipt: DecisionReceipt | undefined;
  const restricted = createRouter(config(), () => ({ eligible: false, code: "restricted", capacity: observed }), { onReceipt: r => { receipt = r; } });
  await assert.rejects(restricted.resolve("wiki/edit:low", { capacity: { ...strict(999), mode: "allow-compaction" } }), error("INELIGIBLE"));
  assert.equal(receipt?.candidates[0]?.reason, "restricted");
  assert.equal(receipt?.candidates[0]?.capacity, undefined);
});
