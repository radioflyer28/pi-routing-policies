import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import virtualModels from "../src/extension.ts";
import { config } from "./fixtures.ts";
import { fixture } from "./sdk-fixture.ts";

type Command = Parameters<ExtensionAPI["registerCommand"]>[1];

for (const autoModel of ["virt/auto", "router/auto"]) test(`/vmodel shares selection and status behavior with /virtual-model (${autoModel})`, async t => {
  const f = await fixture(t, { policy: { ...config(), autoModel }, selection: `${autoModel}/high` });
  const commands = f.loader.getExtensions().extensions.flatMap(e => [...e.commands.entries()]);
  const canonical = commands.find(([name]) => name === "virtual-model")?.[1];
  const shorthand = commands.find(([name]) => name === "vmodel")?.[1];
  assert(canonical && shorthand);
  assert.equal(shorthand.handler, canonical.handler);
  assert(!commands.some(([name]) => name === "virtmodel"));

  await f.session.prompt("/vmodel wiki/edit:low");
  assert.equal(f.session.model?.provider, "wiki");
  assert.equal(f.session.model?.id, "edit/low");
  await f.session.prompt(`/vmodel ${autoModel}:high`);
  assert.equal(f.session.model?.provider, autoModel.split("/")[0]);
  assert.equal(f.session.model?.id, "auto/high");
  await f.session.prompt(`/vmodel ${autoModel}`);
  assert.equal(f.session.model?.id, "auto");

  const status = () => {
    const entry = f.manager.getBranch().findLast(e => e.type === "custom" && e.customType === "virtual-models.diagnostic");
    assert(entry?.type === "custom");
    return (entry.data as any).report;
  };
  await f.session.prompt("/virtual-model");
  const canonicalStatus = status();
  await f.session.prompt("/vmodel");
  assert.deepEqual(status(), canonicalStatus);
  assert.equal(status().autoModel, autoModel);
  assert.equal(status().selected, autoModel);
  assert.equal(f.calls.length, 0);
  assert.equal(f.classified.length, 0);
});

test("/vmodel and /virtual-model share setup help when default configuration is missing", async t => {
  const dir = await mkdtemp(join(tmpdir(), "pi-vm-command-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const originalDir = process.env.PI_CODING_AGENT_DIR;
  const originalConfig = process.env.PI_VIRTUAL_MODELS_CONFIG;
  const commands = new Map<string, Command>();
  try {
    process.env.PI_CODING_AGENT_DIR = dir;
    delete process.env.PI_VIRTUAL_MODELS_CONFIG;
    assert.equal(getAgentDir(), dir);
    const tools: string[] = [];
    const stub: Partial<ExtensionAPI> = { registerCommand: (name, command) => { commands.set(name, command); }, registerTool: tool => { tools.push(tool.name); }, on() { return () => {}; } };
    virtualModels(stub as ExtensionAPI);
    assert.deepEqual(tools, ["virtual_models_advisor"]);
  } finally {
    if (originalDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = originalDir;
    if (originalConfig === undefined) delete process.env.PI_VIRTUAL_MODELS_CONFIG;
    else process.env.PI_VIRTUAL_MODELS_CONFIG = originalConfig;
  }
  assert.deepEqual([...commands.keys()], ["virtual-model", "vmodel"]);
  assert.equal(commands.get("vmodel")!.handler, commands.get("virtual-model")!.handler);
  const notices: string[] = [];
  const ctx = { hasUI: true, ui: { notify: (message: string) => notices.push(message) } } as unknown as ExtensionCommandContext;
  await commands.get("virtual-model")!.handler("", ctx);
  await commands.get("vmodel")!.handler("", ctx);
  assert.equal(notices[0], notices[1]);
  assert(notices[0]?.includes(join(dir, "virtual-models.json")));
  assert(notices[0]?.includes("Nothing was selected or created automatically"));
});
