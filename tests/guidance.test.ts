import assert from "node:assert/strict";
import { test } from "node:test";
import type { PolicyConfig } from "../src/core/index.ts";
import { createRouter, parsePolicy, RoutingError } from "../src/core/index.ts";
import { config, available, answer } from "./fixtures.ts";
import { fixture } from "./sdk-fixture.ts";
const guidance = "GUIDE_WIKI: Prefer tool XYZ for source lookup.\nAvoid ABC unless asked.";
const error = (code: string) => (e: unknown) => e instanceof RoutingError && e.code === code;
function policy(): PolicyConfig { return { ...config(), models: { ...config().models, "wiki/edit": { ...config().models["wiki/edit"]!, instructions: guidance } } }; }

test("role guidance is returned with resolved assignments but excluded from selector requests", async () => {
  const router = createRouter(policy(), available);
  const fixed = await router.resolve("wiki/edit:high");
  assert.equal(fixed.instructions, guidance);
  const decision = await router.prepare("virt/auto", {});
  assert(!JSON.stringify(decision.request).includes("GUIDE_WIKI"));
  const selected = await router.accept(decision, answer("wiki/edit:high"));
  assert.equal(selected.instructions, guidance);
  assert.equal((await router.revalidate({ ...selected, instructions: "forged guidance" })).instructions, guidance);
  assert.equal((await router.resolve("code/review:high")).instructions, undefined);
  await assert.rejects(createRouter(config(), available).revalidate(selected), error("STALE_DECISION"));
});

test("guidance validation accepts prose, not permissions or terminal controls", () => {
  parsePolicy(policy());
  for (const instructions of ["", "   ", 42, "x".repeat(4097), "\u001b[31mterminal injection", "\u009b31mterminal injection"]) {
    const raw = JSON.parse(JSON.stringify(policy())); raw.models["wiki/edit"].instructions = instructions;
    assert.throws(() => parsePolicy(raw), error("INVALID_CONFIG"));
  }
  const raw = JSON.parse(JSON.stringify(policy())); raw.models["wiki/edit"].permissions = { tools: ["XYZ"] };
  assert.throws(() => parsePolicy(raw), error("INVALID_CONFIG"));
});

test("native execution sees current role guidance once per request without accumulating stale roles or changing tools", async t => {
  const f = await fixture(t, { policy: policy(), toolTurn: true });
  const tools = f.session.getActiveToolNames();
  await f.session.prompt("Wiki task.");
  assert.equal(f.executionContexts.length, 2);
  for (const messages of f.executionContexts) {
    assert.equal(JSON.stringify(messages).match(/GUIDE_WIKI/g)?.length, 1);
    assert(!JSON.stringify(messages).includes("Current routing assignment"));
  }
  assert(!JSON.stringify(f.classified).includes("GUIDE_WIKI"));
  assert(!JSON.stringify(f.session.messages).includes("GUIDE_WIKI"));
  assert.deepEqual(f.session.getActiveToolNames(), tools);
  await f.session.prompt("/vmodel code/review:high");
  await f.session.prompt("Code task.");
  assert(!JSON.stringify(f.executionContexts.at(-1)).includes("GUIDE_WIKI"));
});

test("routing metadata is opt-in, request-local, and excluded from dedicated LLM selection", async t => {
  const f = await fixture(t, { policy: { ...config(), routingContext: "assignment", selector: { kind: "llm", provider: "fixture", model: "judge-llm", thinking: "low" } }, toolTurn: true });
  await f.session.prompt("Wiki task.");
  for (const context of f.executionContexts) {
    const text = JSON.stringify(context.filter(m => JSON.stringify(m.content).includes("Current routing assignment")));
    assert.equal(text.match(/Current routing assignment/g)?.length, 1);
    assert(!text.includes("policyRevision"));
    assert(!text.includes("decisionId"));
    assert(!text.includes("judge-llm"));
  }
  assert(!JSON.stringify(f.llmSelections).includes("Current routing assignment"));
  assert(!JSON.stringify(f.session.messages).includes("Current routing assignment"));
  await f.session.prompt("/vmodel wiki/edit:low");
  await f.session.prompt("New task.");
  const note = f.executionContexts.at(-1)!.filter(m => JSON.stringify(m.content).includes("Current routing assignment"));
  assert.equal(note.length, 1);
  assert(JSON.stringify(note).includes("wiki/edit:low"));
  assert(!JSON.stringify(note).includes("wiki/edit:high"));
  const content = note[0]!.content;
  const text = typeof content === "string" ? content : content.filter(b => b.type === "text").map(b => b.text).join("\n");
  assert(text.includes('"thinking":"off"'), "context should report effective physical thinking after clamping");
});
