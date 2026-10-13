import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import type { ExtensionCommandContext, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { ADVISOR_TYPE, advisorInventory, buildAdvisorPolicy, registerAdvisor } from "../src/advisor.ts";
import { readPolicyFile, writePolicyFile } from "../src/advisor-store.ts";
import { parsePolicy, RoutingError } from "../src/core/index.ts";
import { fixture } from "./sdk-fixture.ts";
import { config } from "./fixtures.ts";

const draft = () => ({ namespace: "pr", models: { "pr/review": { defaultEffort: "low", efforts: { low: { provider: "fixture", model: "small", thinking: "off" } }, instructions: "Review evidence; do not merge." } }, criteria: { "pr/review:low": "Low-consequence, bounded review with sufficient evidence; not merely a short diff." }, selector: { kind: "classifier", provider: "fixture", model: "judge" } });
const error = (code: string) => (e: unknown) => e instanceof RoutingError && e.code === code;
type F = Awaited<ReturnType<typeof fixture>>;
const tool = (f: F, args: object) => f.session.getToolDefinition("virtual_models_advisor")!.execute("advisor-test", args, undefined, undefined, { ...f.ctx, tools: [], executeTool: async () => { throw new Error("No nested tools"); } } as ExtensionToolContext);
const command = (f: F, args: string, extra: Partial<ExtensionCommandContext> = {}) => f.loader.getExtensions().extensions.flatMap(e => [...e.commands.entries()]).find(([name]) => name === "vmodel")![1].handler(args, { ...f.ctx, waitForIdle: async () => {}, ...extra } as ExtensionCommandContext);
const report = (f: F): any => { const entry = f.manager.getBranch().findLast(e => e.type === "custom" && e.customType === ADVISOR_TYPE); assert(entry?.type === "custom"); return (entry.data as any).report; };

test("advisor first policy is scoped, fail-closed and does not invent root continuity", () => {
  const { policy, created, changes } = buildAdvisorPolicy(undefined, draft());
  assert(created); assert(changes.length === 3);
  assert.equal(policy.config.autoModel, false);
  assert.deepEqual(Object.keys(policy.automatic), ["pr/auto"]);
  assert.equal(policy.config.nativeRouting, undefined);
  assert(policy.config.questions.route.criteria.__abstain__);
});

test("advisor merge preserves unrelated namespaces and all root settings", () => {
  const base = parsePolicy({ ...config(), namespaces: { wiki: {} }, nativeRouting: { affinity: "session" }, routingContext: "assignment", direct: { provider: "fixture", model: "large", thinking: "off" } });
  const next = buildAdvisorPolicy(base, draft()).policy;
  for (const k of ["autoModel", "selector", "nativeRouting", "routingContext", "direct"] as const) assert.deepEqual(next.config[k], base.config[k]);
  assert.deepEqual(next.config.models["wiki/edit"], base.config.models["wiki/edit"]);
  assert.deepEqual(next.config.namespaces?.wiki, {});
  assert.equal(next.config.questions.route.instructions, base.config.questions.route.instructions);
  assert.equal(next.config.questions.route.criteria.__abstain__, base.config.questions.route.criteria.__abstain__);
  assert.throws(() => buildAdvisorPolicy(next, draft()), error("INVALID_CONFIG"));
  const replacement = draft();
  const replaced = buildAdvisorPolicy(next, { ...replacement, replace: true, models: { "pr/check": replacement.models["pr/review"] }, criteria: { "pr/check:low": "Bounded checks" } }).policy;
  assert(!replaced.config.models["pr/review"]); assert(!replaced.config.questions.route.criteria["pr/review:low"]);
  assert(replaced.config.models["pr/check"]); assert(replaced.config.models["code/review"]);
});

for (const [label, bad] of Object.entries({ crossNamespace: { ...draft(), models: config().models }, rootRewrite: { ...draft(), nativeRouting: { affinity: "session" } }, abstentionRewrite: { ...draft(), criteria: { ...draft().criteria, __abstain__: "Never" } }, missingCriterion: { ...draft(), criteria: {} }, malformedSelector: { ...draft(), selector: {} }, reserved: { ...draft(), namespace: "../pr" } })) test(`advisor rejects ${label}`, () => {
  assert.throws(() => buildAdvisorPolicy(undefined, bad), error("INVALID_CONFIG"));
});

test("advisor inventory is allowlisted, paginated, local and credential-free", async t => {
  const f = await fixture(t, { advisorFile: true });
  const initial = f.session.model;
  const result = (await tool(f, { action: "inspect", provider: "fixture" })).details as any;
  assert.equal(result.models.length, 4);
  assert(result.models.some((m: any) => m.kind === "classifier"));
  assert(result.models.every((m: any) => m.configuredAuth));
  assert(!JSON.stringify(result).includes("not-a-real-key")); assert(!JSON.stringify(result).includes("invalid.example"));
  assert(!result.models.some((m: any) => m.provider === "virt"));
  assert.equal(result.models[0].prices.input, 0);
  assert.equal(result.diskRevision, result.loadedRevision);
  assert.equal(advisorInventory(f.ctx, { provider: "fixture", offset: 4 }).models.length, 0);
  const model = f.ctx.modelRegistry.find("fixture", "small")!;
  const fake = { ...f.ctx, modelRegistry: { ...f.ctx.modelRegistry, getAll: () => Array.from({ length: 60 }, (_, i) => ({ ...model, id: `m${i}`, cost: { input: NaN, output: -1, cacheRead: undefined, cacheWrite: 0 } })), getModelsOfType: () => [], hasConfiguredAuth: () => false } } as unknown as typeof f.ctx;
  const page = advisorInventory(fake, { availableOnly: false });
  assert.equal(page.models.length, 50); assert.equal(page.nextOffset, 50); assert.equal(page.models[0]!.prices.input, null); assert.equal(page.models[0]!.prices.output, null);
  assert.equal(advisorInventory(fake).total, 0);
  assert.equal(f.session.model, initial); assert.equal(f.calls.length + f.classified.length, 0);
});

test("advisor proposal does not write; explicit apply backs up exact bytes and does not reload/select", async t => {
  const f = await fixture(t, { advisorFile: true });
  const file = join(f.dir, "virtual-models.json");
  const before = await readFile(file, "utf8");
  const initial = f.session.model;
  const proposed = (await tool(f, { action: "propose", draft: draft() })).details as any;
  assert.equal(await readFile(file, "utf8"), before);
  assert(proposed.warnings.some((s: string) => s.includes("global router")));
  await command(f, `advisor apply ${proposed.proposalId}`);
  const applied = report(f);
  assert.equal(applied.applied, proposed.proposalId);
  assert.equal(await readFile(applied.backup, "utf8"), before);
  assert(readPolicyFile(file).policy!.config.models["pr/review"]);
  assert(!f.ctx.modelRegistry.find("pr", "review"));
  assert.equal(f.session.model, initial); assert.equal(f.calls.length + f.classified.length, 0);
  await assert.rejects(command(f, `advisor apply ${proposed.proposalId}`), error("STALE_DECISION"));
  assert(!(await readdir(f.dir)).some(name => name.endsWith(".tmp") || name.endsWith(".lock")));
});

test("advisor refuses stale files and rechecks current physical eligibility", async t => {
  const f = await fixture(t, { advisorFile: true });
  const file = join(f.dir, "virtual-models.json");
  const p = (await tool(f, { action: "propose", draft: draft() })).details as any;
  const changed = JSON.stringify(config(), null, 2);
  await writeFile(file, changed);
  await assert.rejects(command(f, `advisor apply ${p.proposalId}`), error("STALE_DECISION"));
  assert.equal(await readFile(file, "utf8"), changed);
  const p2 = (await tool(f, { action: "propose", draft: draft() })).details as any;
  f.api.unregisterProvider("fixture");
  await assert.rejects(command(f, `advisor apply ${p2.proposalId}`), error("INELIGIBLE"));
  assert.equal(await readFile(file, "utf8"), changed);
});

test("advisor handles UI rejection, discard and branch changes without writing", async t => {
  const f = await fixture(t, { advisorFile: true });
  const file = join(f.dir, "virtual-models.json");
  const before = await readFile(file, "utf8");
  const p = (await tool(f, { action: "propose", draft: draft() })).details as any;
  await command(f, `advisor apply ${p.proposalId}`, { hasUI: true, ui: { ...f.ctx.ui, confirm: async () => false } });
  assert.equal(await readFile(file, "utf8"), before);
  await command(f, "advisor discard");
  await assert.rejects(command(f, `advisor apply ${p.proposalId}`), error("STALE_DECISION"));
  const anchor = f.manager.getLeafId()!;
  const p2 = (await tool(f, { action: "propose", draft: draft() })).details as any;
  f.manager.branch(anchor);
  await assert.rejects(command(f, `advisor apply ${p2.proposalId}`), error("STALE_DECISION"));
  assert.equal(await readFile(file, "utf8"), before);
});

test("advisor rejects nonexistent selector, physical aliases, collisions and unsupported tool apply", async t => {
  const f = await fixture(t, { advisorFile: true });
  await assert.rejects(tool(f, { action: "propose", draft: { ...draft(), selector: { kind: "classifier", provider: "fixture", model: "absent" } } }), error("INELIGIBLE"));
  const d = draft(); d.models["pr/review"].efforts.low = { provider: "virt", model: "auto", thinking: "off" };
  await assert.rejects(tool(f, { action: "propose", draft: d }), error("INVALID_CONFIG"));
  f.api.registerProvider("pr", { ...f.provider, models: [{ ...f.provider.models![0]!, id: "review" }] });
  await assert.rejects(tool(f, { action: "propose", draft: draft() }), error("INELIGIBLE"));
  await assert.rejects(tool(f, { action: "apply", proposalId: "anything" }), error("INVALID_STATE"));
});

test("advisor injected factory is read-only; command help runs no inference", async t => {
  const f = await fixture(t);
  const inspection = (await tool(f, { action: "inspect", provider: "fixture" })).details as any;
  assert.equal(inspection.writable, false); assert.equal(inspection.configPath, null);
  await assert.rejects(tool(f, { action: "propose", draft: draft() }), error("INVALID_CONFIG"));
  await command(f, "advisor"); assert(report(f).includes("/skill:routing-policy-advisor"));
  assert.equal(f.calls.length + f.classified.length, 0);
});

test("advisor missing-file setup supports first proposal/apply without an existing policy", async t => {
  let toolDefinition: any;
  const f = await fixture(t);
  const file = join(f.dir, "first.json");
  const handler = registerAdvisor({ ...f.api, registerTool: definition => { toolDefinition = definition; } }, { file });
  const call = (args: object) => toolDefinition.execute("first", args, undefined, undefined, f.ctx);
  assert.equal((await call({ action: "inspect", provider: "fixture" })).details.config, null);
  const p = (await call({ action: "propose", draft: draft() })).details;
  assert.equal(readPolicyFile(file).fingerprint, "missing");
  await handler(`advisor apply ${p.proposalId}`, { ...f.ctx, waitForIdle: async () => {} } as ExtensionCommandContext);
  assert.equal(readPolicyFile(file).policy!.config.autoModel, false);
  assert.equal(report(f).backup, null);
});

test("advisor file store rejects oversized/invalid files, lock conflicts and changed creation state", async t => {
  const dir = await mkdtemp(join(tmpdir(), "advisor-store-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "policy.json");
  await writeFile(file, "x".repeat(262145)); assert.throws(() => readPolicyFile(file), error("INVALID_CONFIG"));
  await writeFile(file, "{oops"); assert.throws(() => readPolicyFile(file), error("INVALID_CONFIG"));
  await writeFile(file, JSON.stringify(config()));
  assert.throws(() => writePolicyFile(file, "missing", config()), error("STALE_DECISION"));
  const original = readPolicyFile(file);
  await writeFile(`${file}.advisor.lock`, "");
  assert.throws(() => writePolicyFile(file, original.fingerprint, config()), error("STALE_DECISION"));
  assert.equal(readPolicyFile(file).fingerprint, original.fingerprint);
});


test("default extension registers onboarding without a policy; missing explicit path still fails", async t => {
  const dir = await mkdtemp(join(tmpdir(), "advisor-default-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const script = `import extension from ${JSON.stringify(pathToFileURL(resolve("src/extension.ts")).href)}; const tools = []; const commands = []; extension({ registerTool: t => tools.push(t.name), registerCommand: n => commands.push(n), on() {} }); console.log(JSON.stringify({ tools, commands }));`;
  const env = { ...process.env, PI_CODING_AGENT_DIR: dir, PI_VIRTUAL_MODELS_CONFIG: "" };
  const startup = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], { env, encoding: "utf8", timeout: 20000 });
  assert.equal(startup.status, 0, startup.stderr);
  assert.deepEqual(JSON.parse(startup.stdout), { tools: ["virtual_models_advisor"], commands: ["virtual-model", "vmodel"] });
  assert.equal(readPolicyFile(join(dir, "virtual-models.json")).fingerprint, "missing");
  const explicit = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], { env: { ...env, PI_VIRTUAL_MODELS_CONFIG: join(dir, "missing.json") }, encoding: "utf8", timeout: 20000 });
  assert.notEqual(explicit.status, 0); assert(explicit.stderr.includes("Explicit policy file does not exist"));
});

test("advisor drafts are bounded, expire and fail across sessions or confirmation changes", async t => {
  const f = await fixture(t, { advisorFile: true });
  const first = (await tool(f, { action: "propose", draft: draft() })).details as any;
  const alien = Object.create(f.ctx.sessionManager);
  alien.getSessionId = () => "another-session";
  await assert.rejects(command(f, `advisor apply ${first.proposalId}`, { sessionManager: alien }), error("STALE_DECISION"));
  for (let i = 0; i < 7; i++) await tool(f, { action: "propose", draft: draft() });
  await assert.rejects(tool(f, { action: "propose", draft: draft() }), error("STALE_DECISION"));
  const future = Date.now() + 1_800_001;
  const clock = t.mock.method(Date, "now", () => future);
  await assert.rejects(command(f, `advisor apply ${first.proposalId}`), error("STALE_DECISION"));
  clock.mock.restore();
  await command(f, "advisor discard");
  const before = await readFile(join(f.dir, "virtual-models.json"), "utf8");
  const p = (await tool(f, { action: "propose", draft: draft() })).details as any;
  await assert.rejects(command(f, `advisor apply ${p.proposalId}`, { hasUI: true, ui: { ...f.ctx.ui, confirm: async () => {
    f.api.unregisterProvider("fixture"); return true;
  } } }), error("INELIGIBLE"));
  assert.equal(await readFile(join(f.dir, "virtual-models.json"), "utf8"), before);
});


test("advisor accepts an observed LLM selector, warns on thinking clamp, and cannot infer", async t => {
  const f = await fixture(t, { advisorFile: true });
  const d = draft(); d.models["pr/review"].efforts.low.thinking = "high";
  const result = (await tool(f, { action: "propose", draft: { ...d, selector: { kind: "llm", provider: "fixture", model: "small", thinking: "high", maxTokens: 256 } } })).details as any;
  assert.equal(result.proposedConfig.namespaces.pr.selector.kind, "llm");
  assert(result.warnings.some((s: string) => s.includes("pr/review:low") && s.includes("clamped")));
  assert(result.warnings.some((s: string) => s.includes("Selector thinking is clamped")));
  assert.equal(f.calls.length + f.classified.length + f.llmSelections.length, 0);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.session.getToolDefinition("virtual_models_advisor")!.execute("cancelled", { action: "inspect" }, controller.signal, undefined, f.ctx as ExtensionToolContext), error("ABORTED"));
});
