import assert from "node:assert/strict";
import { test } from "node:test";
import { createRouter, parsePolicy, RoutingError } from "../src/core/index.ts";
import type { LlmSelectorConfig, PolicyConfig } from "../src/core/index.ts";
import { nativeEntries } from "../src/pi-adapter.ts";
import { answer, available, config } from "./fixtures.ts";
import { fixture } from "./sdk-fixture.ts";
const error = (code: string) => (e: unknown) => e instanceof RoutingError && e.code === code;
const llm: LlmSelectorConfig = { kind: "llm", provider: "fixture", model: "judge-llm", thinking: "low", maxTokens: 512 };
function scoped(): PolicyConfig { return { ...config(), autoModel: "router/auto", selector: llm, namespaces: { wiki: { selector: config().selector }, code: {} } }; }

test("scoped routes inherit or override selectors and constrain only their own candidates", async () => {
  const router = createRouter(scoped(), available);
  assert.deepEqual(router.policy.automatic["code/auto"]?.selector, llm);
  assert.equal(router.policy.automatic["wiki/auto"]?.selector?.kind, "classifier");
  for (const namespace of ["wiki", "code"]) {
    for (const effort of ["low", "medium", "high"]) {
      const decision = await router.prepare(`${namespace}/auto:${effort}`, {});
      const role = namespace === "wiki" ? "edit" : "review";
      assert.deepEqual(Object.keys(decision.request.questions.route.criteria).sort(), ["__abstain__", `${namespace}/${role}:${effort}`].sort());
      const selected = await router.accept(decision, answer(`${namespace}/${role}:${effort}`));
      assert.equal((await router.revalidate(selected)).selection, `${namespace}/auto:${effort}`);
    }
  }
  const global = await router.prepare("router/auto", {});
  assert.equal(Object.keys(global.request.questions.route.criteria).length, 7);
  const scopedDecision = await router.prepare("wiki/auto:high", {});
  await assert.rejects(router.accept(scopedDecision, answer("code/review:high")), error("INVALID_ANSWER"));
  await assert.rejects(router.prepare("wiki/auto", {}, { allowedChoices: ["code/review:high"] }), error("NO_CANDIDATES"));
  const forged = await router.resolve("code/review:high");
  await assert.rejects(router.revalidate({ ...forged, selection: "wiki/auto:high" }), error("STALE_DECISION"));
});

test("global automatic routing can be disabled without disabling scoped or explicit selections", async () => {
  const policy = { ...scoped(), autoModel: false as const };
  const router = createRouter(policy, available);
  assert.equal(router.policy.autoModel, undefined);
  assert(!nativeEntries(policy).some(e => e.selection.startsWith("router/auto") || e.selection.startsWith("virt/auto")));
  assert(nativeEntries(policy).some(e => e.selection === "wiki/auto:high"));
  await router.prepare("wiki/auto", {});
  await router.resolve("code/review:low");
  await assert.rejects(router.prepare("virt/auto", {}), error("INVALID_SELECTION"));
});

test("configuration rejects scope collisions, unknown namespaces, bad selector reasoning/budgets and recursion", () => {
  const invalid: unknown[] = [
    { ...scoped(), autoModel: "wiki/auto" },
    { ...scoped(), namespaces: { missing: {} } },
    { ...scoped(), namespaces: { wiki: { fallback: true } } },
    { ...scoped(), namespaces: { code: {}, wiki: { selector: { ...llm, provider: "code", model: "auto/high" } } } },
    { ...scoped(), selector: { ...llm, thinking: "auto" } },
    { ...scoped(), selector: { ...llm, maxTokens: 0 } },
    { ...scoped(), selector: { ...llm, maxTokens: 8193 } },
    { ...scoped(), selector: { ...config().selector, thinking: "low" } },
    { ...scoped(), routingContext: "all" },
  ];
  for (const policy of invalid) assert.throws(() => parsePolicy(policy), error("INVALID_CONFIG"));
});

test("native scoped routing uses Jev override or inherited LLM in one decision, with independent selector reasoning", async t => {
  const f = await fixture(t, { policy: scoped(), selection: "wiki/auto/high" });
  await f.session.prompt("Wiki task.");
  assert.equal(f.classified.length, 1);
  assert.equal(f.llmSelections.length, 0);
  assert.equal(f.calls.at(-1)?.thinking, "medium");
  await f.session.prompt("/vmodel code/auto:high");
  await f.session.prompt("Code task.");
  assert.equal(f.classified.length, 1);
  assert.equal(f.llmSelections.length, 1);
  assert.equal(f.llmSelections[0]?.thinking, "low");
  assert.equal(f.llmSelections[0]?.maxTokens, 512);
  assert.deepEqual(Object.keys(f.llmSelections[0]!.request.questions.route.criteria).sort(), ["__abstain__", "code/review:high"].sort());
  assert.equal(f.calls.at(-1)?.thinking, "high");
  await f.session.prompt("/vmodel router/auto:high");
  await f.session.prompt("Global task.");
  assert.equal(f.llmSelections.length, 2);
  assert.equal(f.classified.length, 1, "global selection must not chain through the namespace selector");
  assert.equal(f.calls.at(-1)?.thinking, "medium");
});

test("root selector can switch from classifier to LLM on reload while manual resolution remains selector-free", async t => {
  const policy: PolicyConfig = { ...config() };
  const mutable = policy as { selector: PolicyConfig["selector"] };
  const f = await fixture(t, { policy });
  await f.session.prompt("Classifier-selected task.");
  assert.equal(f.classified.length, 1);
  mutable.selector = llm;
  await f.session.reload();
  await f.session.prompt("LLM-selected task.");
  assert.equal(f.llmSelections.length, 1);
  assert.equal(f.classified.length, 1);
  await f.session.prompt("/vmodel wiki/edit:low");
  await f.session.prompt("Explicit task.");
  assert.equal(f.llmSelections.length, 1);
  assert.equal(f.classified.length, 1);
});

test("disabled global router requires an explicit tool selection and supports scoped native startup", async t => {
  const f = await fixture(t, { policy: { ...scoped(), autoModel: false }, selection: "code/auto/high" });
  await f.session.prompt("Scoped code task.");
  assert.equal(f.llmSelections.length, 1);
  const tool = f.session.getToolDefinition("virtual_models")!;
  for (const action of ["select", "prepare"]) {
    await assert.rejects(tool.execute("no-selection", { action, state: { task: "Code task" } }, undefined, undefined,
      { ...f.ctx, tools: [], executeTool: async () => { throw new Error("No nested tools"); } }), error("INVALID_SELECTION"));
  }
  assert.equal(f.llmSelections.length, 1);
});
