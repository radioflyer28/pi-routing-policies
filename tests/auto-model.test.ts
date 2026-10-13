import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { createRouter, DEFAULT_AUTO_MODEL, EFFORTS, parsePolicy, parseSelection, RoutingError } from "../src/core/index.ts";
import type { Assignment, Decision } from "../src/core/index.ts";
import { nativeEntries } from "../src/pi-adapter.ts";
import { answer, available, config } from "./fixtures.ts";
import { fixture } from "./sdk-fixture.ts";
const error = (code: string) => (e: unknown) => e instanceof RoutingError && e.code === code;

test("omitted autoModel retains the existing default without mutating configuration", () => {
  const raw = config();
  const policy = parsePolicy(raw);
  assert.equal(policy.autoModel, DEFAULT_AUTO_MODEL);
  assert.equal(raw.autoModel, undefined);
  assert.deepEqual(parseSelection("virt/auto:medium"), { mode: "auto", effort: "medium" });
});

for (const autoModel of ["router/auto", "my-models/auto", "wiki/auto"]) {
  test(`${autoModel}: automatic naming does not scope candidates or weaken effort constraints`, async () => {
    const router = createRouter({ ...config(), autoModel }, available);
    assert.equal(router.policy.autoModel, autoModel);
    assert.deepEqual(parseSelection(autoModel, autoModel), { mode: "auto" });
    const bare = await router.prepare(autoModel, { task: "work" });
    assert.deepEqual(Object.keys(bare.request.questions.route.criteria).sort(), Object.keys(config().questions.route.criteria).sort());
    for (const effort of EFFORTS) {
      const selection = `${autoModel}:${effort}`;
      assert.deepEqual(parseSelection(selection, autoModel), { mode: "auto", effort });
      const decision = await router.prepare(selection, {});
      assert.deepEqual(Object.keys(decision.request.questions.route.criteria).sort(), ["__abstain__", `code/review:${effort}`, `wiki/edit:${effort}`].sort());
      const assignment = await router.accept(decision, answer(`code/review:${effort}`));
      assert.equal(assignment.selection, selection);
      assert.equal((await router.revalidate(assignment)).choice, `code/review:${effort}`);
    }
    const result = await router.select(`${autoModel}:high`, {}, { select: async () => ({ answer: answer("wiki/edit:high") }) });
    assert.equal(result.assignment.selection, `${autoModel}:high`);
    assert.equal((await router.resolve("wiki/edit")).choice, "wiki/edit:medium");
    for (const unconfigured of ["virt/auto", "unconfigured/auto:high"]) {
      await assert.rejects(router.prepare(unconfigured, {}), error("INVALID_SELECTION"));
      await assert.rejects(router.select(unconfigured, {}), error("INVALID_SELECTION"));
    }
    await assert.rejects(router.resolve(autoModel), error("INVALID_SELECTION"));
    const low = await router.prepare(`${autoModel}:low`, {});
    await assert.rejects(router.accept(low, answer("wiki/edit:high")), error("INVALID_ANSWER"));
  });

  test(`${autoModel}: native registration contains only the configured automatic identity`, () => {
    const entries = nativeEntries({ ...config(), autoModel });
    const [provider, id] = autoModel.split("/");
    assert.deepEqual(entries.slice(0, 4), [
      { provider, id, selection: autoModel },
      ...EFFORTS.map(e => ({ provider, id: `${id}/${e}`, selection: `${autoModel}:${e}` })),
    ]);
    assert(!entries.some(e => e.selection.startsWith("virt/auto")));
    assert.equal(new Set(entries.map(e => `${e.provider}/${e.id}`)).size, entries.length);
    assert(entries.some(e => e.selection === "wiki/edit:high"));
  });
}

test("automatic identity validation rejects malformed names, role collisions and recursive targets", () => {
  for (const autoModel of [null, 1, {}, "", "router", "router/edit", "router/auto:high", "router/auto/high", "Router/auto", "router_/auto", `${"r".repeat(49)}/auto`]) {
    assert.throws(() => parsePolicy({ ...config(), autoModel }), error("INVALID_CONFIG"));
  }
  assert.throws(() => parseSelection("router/auto", "router/edit"), error("INVALID_CONFIG"));
  const autoModel = "router/auto";
  assert.throws(() => parsePolicy({ ...config(), autoModel, models: { ...config().models, [autoModel]: config().models["wiki/edit"] } }), error("INVALID_CONFIG"));
  for (const model of ["auto", ...EFFORTS.flatMap(e => [`auto/${e}`, `auto:${e}`])]) {
    const target = { provider: "router", model, thinking: "off" };
    assert.throws(() => parsePolicy({ ...config(), autoModel, direct: target }), error("INVALID_CONFIG"));
    const raw = JSON.parse(JSON.stringify(config()));
    raw.autoModel = autoModel;
    raw.models["wiki/edit"].efforts.low = target;
    assert.throws(() => parsePolicy(raw), error("INVALID_CONFIG"));
  }
});

test("renaming automatic entry invalidates old decisions and assignments", async () => {
  const previous = createRouter(config(), available);
  const decision = await previous.prepare("virt/auto", {});
  const assignment = (await previous.select("virt/auto:high", {}, { select: async () => ({ answer: answer("wiki/edit:high") }) })).assignment;
  const renamed = createRouter({ ...config(), autoModel: "router/auto" }, available);
  assert.notEqual(renamed.policy.revision, previous.policy.revision);
  await assert.rejects(renamed.accept(decision, answer("wiki/edit:high")), error("STALE_DECISION"));
  await assert.rejects(renamed.revalidate(assignment), error("STALE_DECISION"));
});

test("renaming on reload removes old native entries and accepts the new command identity", async t => {
  const policy = { ...config(), autoModel: "virt/auto" };
  const f = await fixture(t, { policy });
  await f.session.prompt("An initial task.");
  f.runtime.registerVirtualModel({ provider: "virt", id: "unrelated", name: "Other extension", thinkingLevels: ["off"],
    route: async () => ({ model: f.runtime.getModel("fixture", "small")!, thinkingLevel: "off" }) });
  policy.autoModel = "router/auto";
  await f.session.reload();
  for (const id of ["auto", ...EFFORTS.map(e => `auto/${e}`)]) {
    assert.equal(f.runtime.getModel("virt", id), undefined);
    assert(f.runtime.getModel("router", id));
  }
  assert(f.runtime.getModel("virt", "unrelated"));
  await f.session.prompt("/virtual-model router/auto:high");
  assert.equal(f.session.model?.provider, "router");
  await f.session.prompt("A new task after renaming.");
  assert.equal(f.calls.at(-1)?.model, "large");
});

test("custom automatic entry works through startup, commands, tool defaults, reload and resume", async t => {
  const autoModel = "my-models/auto";
  const policy = { ...config(), autoModel };
  const f = await fixture(t, { policy, selection: `${autoModel}/high`, toolTurn: true });
  assert.equal(f.session.model?.provider, "my-models");
  assert.equal(f.runtime.getModel("virt", "auto"), undefined);
  await f.session.prompt("Reconcile sources and continue.");
  assert.equal(f.classified.length, 1);
  assert.equal(f.calls.length, 2);
  assert(f.calls.every(c => c.model === "large"));
  const direct = await f.runtime.resolveModel(f.session.model!, [], { reason: "direct", thinkingLevel: "off" });
  assert.equal(direct.model.id, "large");
  const tool = f.session.getToolDefinition("virtual_models")!;
  const ctx: ExtensionToolContext = { ...f.ctx, tools: [], executeTool: async () => { throw new Error("no nested tools"); } };
  const call = (args: object) => tool.execute("test", args, undefined, undefined, ctx);
  assert.equal(((await call({ action: "list" })).details as { autoModel: string }).autoModel, autoModel);
  const decision = (await call({ action: "prepare", state: { task: "review" } })).details as Decision;
  assert.equal(decision.selection, autoModel);
  const selected = (await call({ action: "answer", decisionId: decision.id, choice: "code/review:high" })).details as Assignment;
  assert.equal(selected.choice, "code/review:high");
  assert.equal(f.session.model?.id, "auto/high");
  await f.session.prompt(`/virtual-model ${autoModel}:low`);
  await f.session.prompt("Mechanical update.");
  assert.equal(f.calls.at(-1)?.model, "small");
  await f.session.prompt(`/virtual-model ${autoModel}`);
  assert.equal(f.session.model?.id, "auto");
  await f.session.prompt("New task with automatic effort.");
  assert.equal(Object.keys((f.classified.at(-1) as Decision["request"]).questions.route.criteria).length, 7);
  await f.session.reload();
  assert.equal(f.session.model?.provider, "my-models");
  assert.equal(f.runtime.getModel("virt", "auto"), undefined);
  f.session.dispose();
  const resumed = await fixture(t, { policy, manager: f.manager });
  assert.equal(resumed.session.model?.provider, "my-models");
  assert.equal(resumed.session.model?.id, "auto");
  await resumed.runtime.resolveModel(resumed.session.model!, [], { reason: "direct", thinkingLevel: "off" });
  assert.equal(resumed.classified.length, 0);
});
