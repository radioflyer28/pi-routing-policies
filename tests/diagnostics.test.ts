import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Theme, ExtensionCommandContext, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { createRouter, RoutingError } from "../src/core/index.ts";
import type { Decision, DecisionReceipt } from "../src/core/index.ts";
import { DIAGNOSTIC_TYPE, parseDiagnostic } from "../src/diagnostics.ts";
import { DECISION_RECEIPT_TYPE } from "../src/decision-notice.ts";
import { currentRouteState, nativeEntries } from "../src/pi-adapter.ts";
import { config } from "./fixtures.ts";
import { fixture } from "./sdk-fixture.ts";

type F = Awaited<ReturnType<typeof fixture>>;
const error = (code: string) => (e: unknown) => e instanceof RoutingError && e.code === code;
const command = (f: F, args: string, ctx = f.ctx as ExtensionCommandContext) => f.loader.getExtensions().extensions.flatMap(e => [...e.commands.entries()]).find(([name]) => name === "vmodel")![1].handler(args, ctx);
function report(f: F): any {
  const entry = f.manager.getBranch().findLast(e => e.type === "custom" && e.customType === DIAGNOSTIC_TYPE);
  assert(entry?.type === "custom");
  return (entry.data as { report: unknown }).report;
}
function records(f: F) { return f.manager.getBranch().filter(e => e.type === "custom" && e.customType === DECISION_RECEIPT_TYPE); }

test("headless JSON CLI emits diagnostic custom entries without starting inference", { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const file = join(f.dir, "policy.json");
  await writeFile(file, JSON.stringify(config()));
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE"]) if (process.env[key]) env[key] = process.env[key];
  env.PI_CODING_AGENT_DIR = f.dir;
  env.PI_VIRTUAL_MODELS_CONFIG = file;
  const run = promisify(execFile)(process.execPath, [resolve("node_modules/@earendil-works/pi-coding-agent/dist/cli.js"), "--no-extensions", "--no-skills", "--no-prompt-templates", "-e", resolve("src/extension.ts"), "--model", "virt/auto/high", "--mode", "json", "--no-session", "/vmodel doctor"], { cwd: f.dir, env, timeout: 20000, maxBuffer: 2_000_000, windowsHide: true });
  run.child.stdin?.end();
  const { stdout } = await run;
  const events = stdout.trim().split("\n").flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const diagnostic = events.find(e => e.type === "entry_appended" && e.entry?.customType === DIAGNOSTIC_TYPE);
  assert(diagnostic, stdout);
  assert.equal(diagnostic.entry.data.kind, "doctor");
  assert(!events.some(e => e.type === "agent_start"));
});

test("diagnostic grammar is bounded, unambiguous and does not consume selections", () => {
  assert.equal(parseDiagnostic("wiki/edit:low"), undefined);
  assert.deepEqual(parseDiagnostic("explain"), { kind: "explain", id: "latest" });
  assert.deepEqual(parseDiagnostic("preview --allow-inference wiki/auto:low -- task\nnext -- line"), { kind: "preview", allowInference: true, selection: "wiki/auto:low", task: "task\nnext -- line" });
  for (const args of ["preview virt/auto task", "preview --allow-inference virt/auto -- ", "preview --bogus virt/auto -- task", "doctor x y", "explain x y", `preview virt/auto -- ${"a".repeat(3001)}`]) assert.throws(() => parseDiagnostic(args), error("INVALID_SELECTION"));
});

test("doctor checks active registry without inference, auth resolution or durable authority handles", async t => {
  const f = await fixture(t);
  const model = f.session.model;
  const before = records(f).length;
  f.ctx.modelRegistry.classify = async () => { throw new Error("must not classify"); };
  f.ctx.modelRegistry.getApiKeyForProvider = async () => { throw new Error("must not resolve auth"); };
  await f.session.prompt("/vmodel doctor virt/auto:low");
  assert.equal(report(f).outcome, "prepared");
  assert(report(f).candidates.some((c: any) => c.reason === "effort"));
  assert.equal(report(f).automatic[0].status, "configured");
  assert.equal(records(f).length, before);
  await f.session.prompt("/virtual-model doctor");
  assert(report(f).registrations.every((r: any) => r.status === "registered"));
  assert.equal(f.session.model, model);
  assert.equal(f.calls.length, 0);
  assert.equal(f.classified.length, 0);
  assert(!f.manager.getBranch().some(e => e.type === "custom_message" && e.customType === DIAGNOSTIC_TYPE));
});

test("doctor diagnoses unavailable targets, selector configuration and registration drift", async t => {
  const policy = config();
  const f = await fixture(t, { policy: { ...policy, selector: { kind: "llm", provider: "fixture", model: "not-registered", thinking: "off" } } });
  const original = f.ctx.modelRegistry.hasConfiguredAuth.bind(f.ctx.modelRegistry);
  f.ctx.modelRegistry.hasConfiguredAuth = () => false;
  f.ctx.modelRegistry.unregisterVirtualModel("wiki", "edit/low");
  await command(f, "doctor");
  assert(report(f).candidates.every((c: any) => !c.eligible && c.code === "auth_missing"));
  assert.equal(report(f).automatic[0].status, "model_missing");
  assert(report(f).registrations.some((r: any) => r.status === "missing"));
  await command(f, "doctor virt/auto:high");
  assert.equal(report(f).errorCode, "NO_CANDIDATES");
  f.ctx.modelRegistry.hasConfiguredAuth = original;
  assert.equal(f.calls.length + f.classified.length + f.llmSelections.length, 0);
});

test("preview requires explicit inference consent; explicit policies bypass the selector", async t => {
  const f = await fixture(t);
  await assert.rejects(command(f, "preview virt/auto -- private task"), error("INVALID_SELECTION"));
  await assert.rejects(command(f, "preview --allow-inference unknown/auto -- private task"), error("INVALID_SELECTION"));
  assert.equal(records(f).length, 0);
  await command(f, "preview wiki/edit:low -- private task");
  assert.equal(report(f).source, "preview");
  assert.equal(report(f).receipt.assignment.choice, "wiki/edit:low");
  assert.equal(report(f).receipt.selector.invoked, false);
  assert.equal(f.classified.length + f.calls.length, 0);
  assert(!JSON.stringify(f.manager.getBranch()).includes("private task"));
});

test("automatic preview preserves selection, sticky assignment, guidance and coordinator handles", async t => {
  const p = config();
  const policy = { ...p, routingContext: "assignment" as const, models: { ...p.models, "wiki/edit": { ...p.models["wiki/edit"]!, instructions: "CURRENT_ROLE_GUIDANCE" } } };
  const f = await fixture(t, { policy });
  await f.session.prompt("original task");
  const state = structuredClone(currentRouteState(f.ctx, nativeEntries(policy)));
  const initial = f.session.model;
  const thinking = f.session.thinkingLevel;
  const tool = f.session.getToolDefinition("virtual_models")!;
  const ctx: ExtensionToolContext = { ...f.ctx, tools: [], executeTool: async () => { throw new Error("no nested tools"); } };
  const prepared = (await tool.execute("prepare", { action: "prepare", selection: "virt/auto:high", state: {} }, undefined, undefined, ctx)).details as Decision;
  await f.session.prompt("/vmodel preview --allow-inference virt/auto:low -- PRIVATE_PREVIEW_TASK");
  const proposed = report(f).receipt as DecisionReceipt;
  assert.equal(proposed.assignment?.choice, "wiki/edit:low");
  assert.equal(proposed.selector.usage.totalTokens, 11);
  assert.equal(f.session.model, initial);
  assert.equal(f.session.thinkingLevel, thinking);
  assert.deepEqual(currentRouteState(f.ctx, nativeEntries(policy)), state);
  assert.equal(f.calls.length, 1);
  const direct = await f.runtime.resolveModel(f.session.model!, [], { reason: "direct", thinkingLevel: "off" });
  assert.equal(direct.model.id, "large");
  await tool.execute("answer", { action: "answer", decisionId: prepared.id, choice: "wiki/edit:high" }, undefined, undefined, ctx);
  await f.session.prompt("/vmodel");
  const status = report(f);
  assert.equal(status.selectorAttempts.invocations, 1);
  assert.equal(status.previewSelectorAttempts.invocations, 1);
  await f.session.prompt("next real task");
  const body = JSON.stringify(f.executionContexts.at(-1));
  assert(!body.includes("PRIVATE_PREVIEW_TASK"));
  assert(!body.includes(proposed.id));
  assert(!body.includes("Proposal only"));
  assert(!body.includes("previewSelectorAttempts"));
  assert(!body.includes("selectorUsage"));
  assert(body.includes("CURRENT_ROLE_GUIDANCE"));
  assert(!JSON.stringify(f.manager.getBranch()).includes("PRIVATE_PREVIEW_TASK"));
});

test("scoped LLM preview uses inherited/overridden policy in one decision with no execution call", async t => {
  const p = config();
  const f = await fixture(t, { policy: { ...p, autoModel: false, namespaces: { wiki: { selector: { kind: "llm", provider: "fixture", model: "judge-llm", thinking: "low" } } } }, selection: "wiki/auto/high" });
  await command(f, "preview --allow-inference wiki/auto:low -- a text task");
  assert.equal(f.llmSelections.length, 1);
  assert.equal(f.classified.length + f.calls.length, 0);
  assert.deepEqual(Object.keys(f.llmSelections[0]!.request.questions.route.criteria).sort(), ["__abstain__", "wiki/edit:low"]);
  assert.equal(report(f).receipt.assignment.choice, "wiki/edit:low");
});

test("explain reads the exact original receipt without inference or current revalidation", async t => {
  const f = await fixture(t);
  await command(f, "preview --allow-inference virt/auto:high -- task");
  const original = structuredClone(report(f).receipt);
  f.ctx.modelRegistry.hasConfiguredAuth = () => { throw new Error("must not revalidate"); };
  await command(f, `explain ${original.id}`);
  assert.deepEqual(report(f).receipt, original);
  assert.equal(report(f).source, "preview");
  assert.equal(f.classified.length, 1);
  assert.equal(records(f).length, 1);
  await command(f, "explain");
  assert.deepEqual(report(f).receipt, original);
  await assert.rejects(command(f, `explain ${original.decisionId}`), error("STALE_DECISION"));
});

test("explain is branch-local and labels historical revisions rather than reconstructing decisions", async t => {
  const f = await fixture(t);
  const anchor = f.manager.getLeafId()!;
  let receipt: DecisionReceipt | undefined;
  await createRouter({ ...config(), routingContext: "assignment" }, () => ({ eligible: true }), { onReceipt: r => { receipt = r; } }).resolve("wiki/edit:low");
  f.manager.appendCustomEntry(DECISION_RECEIPT_TYPE, { source: "tool", receipt });
  await command(f, "explain latest");
  assert.equal(report(f).historicalPolicy, true);
  assert.deepEqual(report(f).receipt, receipt);
  f.manager.branch(anchor);
  await assert.rejects(command(f, `explain ${receipt!.id}`), error("STALE_DECISION"));
  await assert.rejects(command(f, "explain"), error("STALE_DECISION"));
  assert.equal(f.classified.length + f.calls.length, 0);
});

test("unexpected preview failures retain a safe terminal receipt rather than raw error prose", async t => {
  const f = await fixture(t);
  f.ctx.modelRegistry.hasConfiguredAuth = () => { throw new Error("PRIVATE_AUTH_DETAILS"); };
  await command(f, "preview --allow-inference virt/auto -- PRIVATE_TASK");
  assert.equal(report(f).receipt.errorCode, "INTERNAL_ERROR");
  assert.equal(report(f).receipt.selector.invoked, false);
  assert(!JSON.stringify(f.manager.getBranch()).includes("PRIVATE_AUTH_DETAILS"));
  assert(!JSON.stringify(f.manager.getBranch()).includes("PRIVATE_TASK"));
  assert.equal(f.calls.length, 0);
});

test("failed and timed-out previews retain diagnostic receipts without fallback or unknown-cost erasure", async t => {
  const p = config();
  const f = await fixture(t, { policy: { ...p, selector: { ...p.selector!, timeoutMs: 10 } } });
  f.ctx.modelRegistry.classify = () => new Promise(() => {});
  await command(f, "preview --allow-inference virt/auto -- secret");
  assert.equal(report(f).receipt.errorCode, "SELECTOR_TIMEOUT");
  assert.equal(report(f).receipt.selector.usage.cost, null);
  assert.equal(f.calls.length, 0);
  await command(f, "explain");
  assert.equal(report(f).receipt.errorCode, "SELECTOR_TIMEOUT");
});

test("diagnostic rendering is narrow-width safe, bounded and has no duplicate receipt notice", async t => {
  initTheme("dark", false);
  const theme = { fg: (_color: string, text: string) => text } as Theme;
  const f = await fixture(t);
  await command(f, "preview wiki/edit:low -- task");
  const entry = f.manager.getBranch().findLast(e => e.type === "custom" && e.customType === DIAGNOSTIC_TYPE)!;
  assert(entry.type === "custom");
  const extensions = f.loader.getExtensions().extensions;
  const renderer = extensions.find(e => e.entryRenderers?.has(DIAGNOSTIC_TYPE))!.entryRenderers!.get(DIAGNOSTIC_TYPE)!;
  for (const expanded of [false, true]) {
    const component = renderer(entry, { expanded }, theme)!;
    for (const width of [10, 40, 100]) assert(component.render(width).every(line => visibleWidth(line) <= width));
  }
  const huge = { ...entry, data: { version: 1, kind: "doctor", report: { text: "x".repeat(40000) + "\u001b[31m" } } };
  const text = renderer(huge, { expanded: true }, theme)!.render(100).join("\n");
  assert(text.includes("Display truncated"));
  assert(!text.includes("\u001b"));
  const receiptRenderer = extensions.find(e => e.entryRenderers?.has(DECISION_RECEIPT_TYPE))!.entryRenderers!.get(DECISION_RECEIPT_TYPE)!;
  const record = records(f)[0]!;
  assert(record.type === "custom");
  assert.equal(receiptRenderer(record, { expanded: true }, theme), undefined);
});

test("reload cancels pending preview and does not persist its result into the replacement runtime", async t => {
  const f = await fixture(t);
  const registry = f.ctx.modelRegistry;
  const original = registry.classify.bind(registry);
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  registry.classify = () => { entered(); return new Promise(() => {}); };
  const running = command(f, "preview --allow-inference virt/auto -- secret");
  await ready;
  await f.session.reload();
  await running;
  assert.equal(records(f).length, 0);
  registry.classify = original;
  await f.session.prompt("/vmodel preview --allow-inference virt/auto -- new task");
  assert.equal(report(f).receipt.outcome, "assigned");
  assert.equal(f.calls.length, 0);
});

test("preview cancellation is bounded and abandoned-branch results are not appended elsewhere", async t => {
  const f = await fixture(t);
  let entered!: () => void;
  let ready = new Promise<void>(resolve => { entered = resolve; });
  f.ctx.modelRegistry.classify = () => { entered(); return new Promise(() => {}); };
  const abort = new AbortController();
  const running = command(f, "preview --allow-inference virt/auto -- secret", { ...f.ctx, signal: abort.signal } as ExtensionCommandContext);
  await ready;
  await assert.rejects(command(f, "preview --allow-inference virt/auto -- second"), error("INVALID_STATE"));
  abort.abort();
  await running;
  assert.equal(report(f).receipt.errorCode, "ABORTED");
  const root = f.manager.getLeafId()!;
  f.manager.appendCustomEntry("fixture-anchor", {});
  ready = new Promise<void>(resolve => { entered = resolve; });
  const abort2 = new AbortController();
  const abandoned = command(f, "preview --allow-inference virt/auto -- secret", { ...f.ctx, signal: abort2.signal } as ExtensionCommandContext);
  await ready;
  f.manager.branch(root);
  const before = f.manager.getBranch().length;
  abort2.abort();
  await abandoned;
  assert.equal(f.manager.getBranch().length, before);
  assert.equal(f.calls.length, 0);
});
