import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionCommandContext, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
// Exercise the actual pinned host widgets, not a mock's string-length estimate.
import { KeybindingsManager } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import { ExtensionEditorComponent } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/extension-editor.js";
import { ExtensionSelectorComponent } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/extension-selector.js";
import { initTheme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { RoutingError } from "../src/core/index.ts";
import { fixture } from "./sdk-fixture.ts";

initTheme("dark", false);
type F = Awaited<ReturnType<typeof fixture>>;
const namespace = "n".repeat(48);
const draft = () => ({
  namespace,
  models: Object.fromEntries(["implement", "review", "explain"].map(role => [`${namespace}/${role}`, {
    defaultEffort: "medium",
    efforts: Object.fromEntries(["low", "medium", "high"].map(effort => [effort, { provider: "fixture", model: "small", thinking: "off" }])),
    instructions: "Inspect evidence and explain uncertainty. 確認 🧪 ".repeat(60),
  }])),
  criteria: Object.fromEntries(["implement", "review", "explain"].flatMap(role => ["low", "medium", "high"].map(effort => [`${namespace}/${role}:${effort}`, "Bounded coding work with sufficient evidence. ".repeat(60)]))),
  selector: { kind: "classifier", provider: "fixture", model: "judge" },
});
const propose = async (f: F) => (await f.session.getToolDefinition("virtual_models_advisor")!.execute("ui-test", { action: "propose", draft: draft() }, undefined, undefined, {
  ...f.ctx, tools: [], executeTool: async () => { throw new Error("No nested tools"); },
} as ExtensionToolContext)).details as { proposalId: string; proposedConfig: unknown; changes: unknown[] };
const apply = (f: F, id: string, ui: ExtensionCommandContext["ui"]) => f.loader.getExtensions().extensions.flatMap(e => [...e.commands.entries()]).find(([name]) => name === "vmodel")![1].handler(`advisor apply ${id}`, {
  ...f.ctx, hasUI: true, waitForIdle: async () => {}, ui,
} as ExtensionCommandContext);

// The pre-fix apply path rendered a long valid proposal as a 296-row title
// in an 80-column, 24-row terminal, below which the choices disappeared.
test("large advisor review and approval fit real Pi widgets after narrow/wide resize", async t => {
  const f = await fixture(t, { advisorFile: true });
  const file = join(f.dir, "virtual-models.json");
  const before = await readFile(file, "utf8");
  const initial = f.session.model;
  const p = await propose(f);
  let reviews = 0, confirmations = 0;
  await apply(f, p.proposalId, { ...f.ctx.ui,
    editor: async (title, prefill) => {
      reviews++;
      const report = JSON.parse(prefill!);
      assert.equal(report.file, file);
      assert.deepEqual(report.config, p.proposedConfig);
      assert.deepEqual(report.changes, p.changes);
      const terminal = { rows: 24, columns: 80 };
      const tui = { terminal, requestRender() {} } as unknown as TUI;
      const editor = new ExtensionEditorComponent(tui, new KeybindingsManager(), title, prefill, () => {}, () => {});
      for (const width of [80, 40, 120, 80]) {
        terminal.columns = width;
        const lines = editor.render(width);
        assert(lines.length <= 20, `review is ${lines.length} rows at width ${width}`);
        assert(lines.some(line => line.includes("submit")), "review continue hint stays visible");
        editor.handleInput("\u001b[5~"); // PageUp scrolls without editing the report.
        editor.render(width);
      }
      return prefill;
    },
    confirm: async (title, message) => {
      confirmations++;
      assert.equal(reviews, 1, "full report is reviewed before approval");
      assert(message.includes(namespace));
      assert(message.includes(`${p.changes.length} changes`));
      const selector = new ExtensionSelectorComponent(`${title}\n${message}`, ["Yes", "No"], () => {}, () => {});
      for (const width of [80, 40, 120, 80]) {
        const lines = selector.render(width);
        assert(lines.length <= 20, `confirmation is ${lines.length} rows at width ${width}`);
        assert(lines.some(line => line.includes("Yes")));
        assert(lines.some(line => line.includes("No")));
        assert(lines.some(line => line.includes("cancel")));
      }
      selector.dispose();
      return false;
    },
  });
  assert.equal(reviews, 1); assert.equal(confirmations, 1);
  assert.equal(await readFile(file, "utf8"), before);
  assert.equal(f.session.model, initial);
  assert.equal(f.calls.length + f.classified.length, 0);
});

test("review cancellation, edits and declined approval preserve the draft and policy", async t => {
  const f = await fixture(t, { advisorFile: true });
  const file = join(f.dir, "virtual-models.json");
  const before = await readFile(file, "utf8");
  const p = await propose(f);
  let confirmations = 0;
  const notices: string[] = [];
  const ui = { ...f.ctx.ui, notify: (message: string) => { notices.push(message); }, confirm: async () => { confirmations++; return false; } };
  await apply(f, p.proposalId, { ...ui, editor: async () => undefined });
  await apply(f, p.proposalId, { ...ui, editor: async (_title, prefill) => prefill + " " });
  await apply(f, p.proposalId, { ...ui, editor: async (_title, prefill) => {
    const edited = JSON.parse(prefill!);
    edited.config.questions.route.criteria[`${namespace}/review:medium`] = "Changed routing criterion";
    return JSON.stringify(edited, null, 2);
  } });
  assert.equal(confirmations, 0);
  assert(notices.some(message => message.includes("not applied")));
  assert.equal(await readFile(file, "utf8"), before);
  await apply(f, p.proposalId, { ...ui, editor: async (_title, prefill) => prefill });
  assert.equal(confirmations, 1);
  assert.equal(await readFile(file, "utf8"), before);
  await apply(f, p.proposalId, { ...ui, editor: async (_title, prefill) => prefill, confirm: async () => true });
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), p.proposedConfig);
  assert.equal(f.calls.length + f.classified.length, 0);
});

test("branch changes while reviewing prevent confirmation and writing", async t => {
  const f = await fixture(t, { advisorFile: true });
  const file = join(f.dir, "virtual-models.json");
  const before = await readFile(file, "utf8");
  const anchor = f.manager.getLeafId()!;
  const p = await propose(f);
  await assert.rejects(apply(f, p.proposalId, { ...f.ctx.ui,
    editor: async (_title, prefill) => { f.manager.branch(anchor); return prefill; },
    confirm: async () => { assert.fail("stale review must not reach approval"); },
  }), (e: unknown) => e instanceof RoutingError && e.code === "STALE_DECISION");
  assert.equal(await readFile(file, "utf8"), before);
});
