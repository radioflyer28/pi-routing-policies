import assert from "node:assert/strict";
import { test } from "node:test";
import { createRouter, parsePolicy, parseSelection, RoutingError } from "../src/core/index.ts";
import { config, available, answer } from "./fixtures.ts";
const error = (code: string) => (e: unknown) => e instanceof RoutingError && e.code === code;

test("policy is immutable, revisions are content-based, and defaults resolve", async () => {
  const raw = config();
  const router = createRouter(raw, available);
  assert.equal(router.policy.revision, parsePolicy(JSON.parse(JSON.stringify(raw))).revision);
  assert(Object.isFrozen(router.policy.config.models["wiki/edit"]!.efforts));
  assert.throws(() => { (router.policy.variants as Record<string, unknown>).fake = {}; }, TypeError);
  const result = await router.resolve("wiki/edit");
  assert.equal(result.choice, "wiki/edit:medium");
  assert.equal(result.target.thinking, "low");
});

test("bare auto and explicit medium remain distinct", () => {
  assert.deepEqual(parseSelection("virt/auto"), { mode: "auto" });
  assert.deepEqual(parseSelection("virt/auto:medium"), { mode: "auto", effort: "medium" });
  for (const value of ["wiki/auto", "wiki/edit:auto", "wiki/edit:", "wiki/edit:low:high", "../edit", "wiki/edit/high"]) {
    assert.throws(() => parseSelection(value), error("INVALID_SELECTION"));
  }
});

test("config rejects unknown fields, missing criteria/defaults, invalid target thinking, recursion and non-JSON", () => {
  const base = () => JSON.parse(JSON.stringify(config()));
  const mutations = [
    (c: any) => { c.typo = true; },
    (c: any) => { delete c.questions.route.criteria["wiki/edit:low"]; },
    (c: any) => { c.questions.route.criteria.fake = "bad"; },
    (c: any) => { c.models["wiki/edit"].defaultEffort = "off"; },
    (c: any) => { c.models["wiki/edit"].efforts.low.thinking = "automatic"; },
    (c: any) => { c.models["wiki/edit"].efforts.low = { provider: "virt", model: "auto", thinking: "low" }; },
    (c: any) => { c.models["wiki/edit"].efforts.low = { provider: "wiki", model: "edit/high", thinking: "low" }; },
    (c: any) => { c.selector.timeoutMs = -1; },
    (c: any) => { c.selector = { kind: "llm" }; },
    (c: any) => { c.direct = { provider: "x", model: "y", thinking: "bad" }; },
  ];
  for (const mutate of mutations) { const c = base(); mutate(c); assert.throws(() => parsePolicy(c), error("INVALID_CONFIG")); }
  for (const input of [null, [], { version: NaN }, { version: undefined }, { date: new Date() }]) assert.throws(() => parsePolicy(input), error("INVALID_CONFIG"));
  const cyclic: any = {}; cyclic.self = cyclic;
  assert.throws(() => parsePolicy(cyclic), error("INVALID_CONFIG"));
});

test("physical slash/colon IDs are preserved", async () => {
  const raw = JSON.parse(JSON.stringify(config()));
  raw.models["wiki/edit"].efforts.low.model = "vendor/model:quantized";
  assert.equal((await createRouter(raw, available).resolve("wiki/edit:low")).target.model, "vendor/model:quantized");
});

for (const effort of ["low", "medium", "high"]) test(`auto:${effort} only offers matching effort and preserves criteria`, async () => {
  const router = createRouter(config(), available);
  const decision = await router.prepare(`virt/auto:${effort}`, { task: "work" });
  assert.equal(decision.request.questions.route.instructions, config().questions.route.instructions);
  assert.deepEqual(Object.keys(decision.request.questions.route.criteria).sort(), ["__abstain__", `code/review:${effort}`, `wiki/edit:${effort}`].sort());
  const result = await router.accept(decision, answer(`wiki/edit:${effort}`));
  assert.equal(result.choice, `wiki/edit:${effort}`);
  assert.equal(result.decisionId, decision.id);
  await assert.rejects(router.accept(decision, answer(`wiki/edit:${effort}`)), error("STALE_DECISION"));
});

test("bare auto offers all eligible variants; hard constraints intersect", async () => {
  const router = createRouter(config(), t => ({ eligible: t.model === "large" }));
  const decision = await router.prepare("virt/auto", {}, { allowedChoices: ["wiki/edit:low", "wiki/edit:high"] });
  assert.deepEqual(Object.keys(decision.request.questions.route.criteria), ["wiki/edit:high", "__abstain__"]);
  await assert.rejects(router.resolve("wiki/edit:low", { allowedChoices: ["wiki/edit:high"] }), error("INELIGIBLE"));
  await assert.rejects(router.prepare("virt/auto:low", {}), error("NO_CANDIDATES"));
  await assert.rejects(router.prepare("virt/auto", {}, { allowedChoices: [] }), error("NO_CANDIDATES"));
  await assert.rejects(router.prepare("virt/auto", {}, { allowedChoices: ["missing/role:low"] }), error("INVALID_SELECTION"));
});

test("explicit select bypasses the selector even when unavailable", async () => {
  const router = createRouter(config(), available);
  const { assignment } = await router.select("wiki/edit:high", {}, { select: async () => { throw new Error("must not call"); } });
  assert.equal(assignment.target.thinking, "medium");
  await router.select("wiki/edit", {});
  await assert.rejects(router.select("virt/auto", {}), error("SELECTOR_UNAVAILABLE"));
});

test("coordinator/LLM answers need no confidence; classifier metadata can coexist", async () => {
  const router = createRouter(config(), available);
  for (const extra of [{}, { confidence: 0.8, probabilities: { "wiki/edit:high": 0.8 } }]) {
    const decision = await router.prepare("virt/auto", {});
    const response = answer("wiki/edit:high");
    Object.assign(response.answers.route, extra);
    assert.equal((await router.accept(decision, response)).choice, "wiki/edit:high");
  }
});

test("malformed answers, forbidden choices, abstention and stale handles fail closed", async () => {
  const router = createRouter(config(), available);
  for (const bad of [null, {}, "wiki/edit:low", answer("invented"), answer("wiki/edit:high")]) {
    const decision = await router.prepare("virt/auto:low", {});
    await assert.rejects(router.accept(decision, bad), error("INVALID_ANSWER"));
  }
  const decision = await router.prepare("virt/auto", {});
  await assert.rejects(router.accept(decision, answer("__abstain__")), error("ABSTAINED"));
  const stale = await router.prepare("virt/auto", {});
  await assert.rejects(createRouter(config(), available).accept(stale, answer("wiki/edit:low")), error("STALE_DECISION"));
  await assert.rejects(router.accept(structuredClone(stale), answer("wiki/edit:low")), error("STALE_DECISION"));
});

test("availability is rechecked after selection and before reuse", async () => {
  let allowed = true;
  const router = createRouter(config(), () => ({ eligible: allowed }));
  const decision = await router.prepare("virt/auto", {});
  const assignment = await router.resolve("wiki/edit:high");
  allowed = false;
  await assert.rejects(router.accept(decision, answer("wiki/edit:high")), error("INELIGIBLE"));
  await assert.rejects(router.revalidate(assignment), error("INELIGIBLE"));
  allowed = true;
  const changed = JSON.parse(JSON.stringify(config())); changed.models["wiki/edit"].efforts.high.thinking = "high";
  await assert.rejects(createRouter(changed, available).revalidate(assignment), error("STALE_DECISION"));
  await assert.rejects(router.revalidate({ ...assignment, target: { ...assignment.target, model: "other" } }), error("STALE_DECISION"));
});

test("state is bounded JSON and snapshotted; required inputs reach inventory; abort is explicit", async () => {
  const router = createRouter(config(), (_t, inputs) => ({ eligible: inputs.includes("image") }));
  const state = { task: "initial" };
  const decision = await router.prepare("virt/auto", state, { requiredInputs: ["image"] });
  state.task = "changed";
  assert.equal(decision.request.state.task, "initial");
  await assert.rejects(router.prepare("virt/auto", { task: "x".repeat(17_000) }), error("INVALID_STATE"));
  const cycle: any = {}; cycle.self = cycle;
  await assert.rejects(router.prepare("virt/auto", cycle), error("INVALID_STATE"));
  await assert.rejects(router.resolve("wiki/edit:high", {}, AbortSignal.abort()), error("ABORTED"));
});
