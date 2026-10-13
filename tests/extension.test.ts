import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../src/extension.ts";
import type { Assignment, Decision } from "../src/core/index.ts";
import { RoutingError } from "../src/core/index.ts";
import { config } from "./fixtures.ts";
import { fixture } from "./sdk-fixture.ts";
const error = (code: string) => (e: unknown) => e instanceof RoutingError && e.code === code;

test("bounded config loading rejects malformed and oversized files", async t => {
  const dir = await mkdtemp(join(tmpdir(), "pi-vm-config-"));
  t.after(() => rm(dir, { force: true, recursive: true }));
  const file = join(dir, "config.json");
  await writeFile(file, JSON.stringify(config()));
  assert.deepEqual(loadConfig(file), config());
  await writeFile(file, "{oops"); assert.throws(() => loadConfig(file), error("INVALID_CONFIG"));
  await writeFile(file, "x".repeat(262145)); assert.throws(() => loadConfig(file), error("INVALID_CONFIG"));
});

test("coordinator tool prepares, accepts and resolves child assignments without switching parent", async t => {
  const f = await fixture(t);
  const tool = f.session.getToolDefinition("virtual_models")!;
  assert(tool);
  const ctx: ExtensionToolContext = { ...f.ctx, tools: [], executeTool: async () => { throw new Error("no nested tools"); } };
  const call = (args: object) => tool.execute("test", args, undefined, undefined, ctx);
  const initial = f.session.model;
  const listed = await call({ action: "list" });
  assert((listed.details as any).questions.route.criteria["wiki/edit:high"]);
  const prepared = await call({ action: "prepare", selection: "virt/auto:high", state: { task: "docs" }, allowedChoices: ["wiki/edit:high"] });
  const decision = prepared.details as Decision;
  assert.deepEqual(Object.keys(decision.request.questions.route.criteria), ["wiki/edit:high", "__abstain__"]);
  const result = await call({ action: "answer", decisionId: decision.id, choice: "wiki/edit:high" });
  assert.equal((result.details as Assignment).target.model, "large");
  assert.equal(f.session.model, initial);
  assert.equal(f.classified.length, 0);
  await assert.rejects(call({ action: "answer", decisionId: decision.id, choice: "wiki/edit:high" }), error("STALE_DECISION"));
  const explicit = await call({ action: "resolve", selection: "wiki/edit:low" });
  assert.equal((explicit.details as Assignment).choice, "wiki/edit:low");
});

test("pending coordinator decisions are branch-local and cannot widen offered choices", async t => {
  const f = await fixture(t);
  const tool = f.session.getToolDefinition("virtual_models")!;
  const ctx: ExtensionToolContext = { ...f.ctx, tools: [], executeTool: async () => { throw new Error("no nested tools"); } };
  const call = (args: object) => tool.execute("test", args, undefined, undefined, ctx);
  const before = f.manager.getLeafId()!;
  const first = (await call({ action: "prepare", selection: "virt/auto:low", state: {} })).details as Decision;
  await assert.rejects(call({ action: "answer", decisionId: first.id, choice: "wiki/edit:high" }), error("INVALID_ANSWER"));
  const second = (await call({ action: "prepare", selection: "virt/auto:high", state: {} })).details as Decision;
  f.manager.branch(before);
  await assert.rejects(call({ action: "answer", decisionId: second.id, choice: "wiki/edit:high" }), error("STALE_DECISION"));
});

for (const autoModel of ["virt/auto", "router/auto", "my-models/auto"]) test(`isolated CLI/RPC startup selects ${autoModel}/high before the first prompt`, { timeout: 30000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), "pi-vm-cli-"));
  await writeFile(join(dir, "virtual-models.json"), JSON.stringify({ ...config(), autoModel }));
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE"]) if (process.env[key]) env[key] = process.env[key];
  env.PI_CODING_AGENT_DIR = dir;
  env.PI_VIRTUAL_MODELS_CONFIG = join(dir, "virtual-models.json");
  const cli = resolve("node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
  const child = spawn(process.execPath, [cli, "--no-extensions", "--no-skills", "--no-prompt-templates", "-e", resolve("src/extension.ts"), "--model", `${autoModel}/high`, "--mode", "rpc", "--no-session"], { cwd: dir, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const exited = new Promise<void>(resolve => child.once("close", () => resolve()));
  t.after(async () => { child.kill(); await exited; await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += String(chunk); });
  const state = await new Promise<any>((resolveState, reject) => {
    let output = "";
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`CLI state timed out: ${stderr}`)); }, 20000);
    child.once("error", err => { clearTimeout(timeout); reject(err); });
    child.once("exit", code => { clearTimeout(timeout); reject(new Error(`CLI exited ${code}: ${stderr}`)); });
    child.stdout.on("data", chunk => {
      output += String(chunk);
      let index: number;
      while ((index = output.indexOf("\n")) >= 0) {
        const line = output.slice(0, index); output = output.slice(index + 1);
        try {
          const event = JSON.parse(line);
          if (event.type === "response" && event.id === "state") { clearTimeout(timeout); resolveState(event); }
        } catch { /* CLI startup text is not a protocol response. */ }
      }
    });
    child.stdin.write(JSON.stringify({ type: "get_state", id: "state" }) + "\n");
  });
  assert.equal(state.success, true, JSON.stringify(state));
  assert.equal(state.data.model.provider, autoModel.split("/")[0]);
  assert.equal(state.data.model.id, "auto/high");
  assert.equal(state.data.thinkingLevel, "off");
});
