import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { initTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionToolContext, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { renderRoutingNotice, ROUTING_NOTICE_TYPE, selectorDiagnostics } from "../src/routing-notice.ts";
import type { RoutingNotice } from "../src/routing-notice.ts";
import type { Assignment, PolicyConfig } from "../src/core/index.ts";
import { config } from "./fixtures.ts";
import { fixture } from "./sdk-fixture.ts";
initTheme("dark", false);
const theme = { fg: (_color: string, text: string) => text } as Theme;
const llmPolicy: PolicyConfig = { ...config(), autoModel: "router/auto", selector: { kind: "llm", provider: "fixture", model: "judge-llm", thinking: "low" }, namespaces: { wiki: {}, code: {} } };

test("native routing emits a compact expandable entry outside context, with no sticky-continuation duplicates", async t => {
  const f = await fixture(t, { policy: llmPolicy, selection: "wiki/auto/high", toolTurn: true });
  await f.session.prompt("PRIVATE_TASK: reconcile wiki sources.");
  const notices = f.manager.getBranch().filter(e => e.type === "custom" && e.customType === ROUTING_NOTICE_TYPE);
  assert.equal(notices.length, 1);
  assert.equal(f.calls.length, 2);
  const entry = notices[0]!;
  assert(entry.type === "custom");
  const data = entry.data as RoutingNotice;
  assert.equal(data.selection, "wiki/auto:high");
  assert.equal(data.choice, "wiki/edit:high");
  assert.equal(data.selector?.model, "judge-llm");
  assert.equal(data.selector?.effectiveThinking, "low");
  assert(!JSON.stringify(data).includes("PRIVATE_TASK"));
  assert(!JSON.stringify(f.executionContexts).includes(ROUTING_NOTICE_TYPE));
  assert(!JSON.stringify(f.executionContexts).includes("Policy revision:"));
  const renderer = f.loader.getExtensions().extensions.find(e => e.entryRenderers?.has(ROUTING_NOTICE_TYPE))!.entryRenderers!.get(ROUTING_NOTICE_TYPE)!;
  const collapsed = renderer(entry, { expanded: false }, theme)!;
  assert.equal(collapsed.render(160).length, 1);
  assert(collapsed.render(160)[0]?.includes("wiki/auto:high → fixture/large"));
  assert(!collapsed.render(160)[0]?.includes("wiki/edit:high"));
  const expanded = renderer(entry, { expanded: true }, theme)!;
  const text = expanded.render(160).join("\n");
  assert(text.includes("Policy variant: wiki/edit:high"));
  assert(text.includes("Selector: llm fixture/judge-llm"));
  assert(text.includes("requested low; effective low"));
  assert(text.includes("Policy revision:"));
  for (const width of [10, 30, 80]) {
    for (const component of [collapsed, expanded]) assert(component.render(width).every(line => visibleWidth(line) <= width));
  }
  await f.runtime.resolveModel(f.session.model!, [], { reason: "direct", thinkingLevel: "off" });
  assert.equal(f.manager.getBranch().filter(e => e.type === "custom" && e.customType === ROUTING_NOTICE_TYPE).length, 2);
  assert.equal(f.llmSelections.length, 1);
});

test("automatic tool selection returns the assignment to the model and keeps selector diagnostics in expandable UI details", async t => {
  const f = await fixture(t, { policy: llmPolicy, selection: "wiki/auto/high" });
  const initial = f.session.model;
  const tool = f.session.getToolDefinition("virtual_models")!;
  const ctx: ExtensionToolContext = { ...f.ctx, tools: [], executeTool: async () => { throw new Error("no nested tools"); } };
  const result = await tool.execute("tool-route", { action: "select", selection: "code/auto:high", state: { task: "PRIVATE_TOOL_TASK" } }, undefined, undefined, ctx);
  assert.equal((result.details as Assignment).choice, "code/review:high");
  assert.equal(result.usage?.totalTokens, 2);
  assert.equal(f.llmSelections.length, 1);
  assert.equal(f.calls.length, 0);
  assert.equal(f.session.model, initial);
  const content = result.content.filter(b => b.type === "text").map(b => b.text).join("\n");
  assert(content.includes("code/review:high"));
  assert(!content.includes("judge-llm"));
  assert(!content.includes("PRIVATE_TOOL_TASK"));
  const renderContext = { isError: false } as Parameters<NonNullable<ToolDefinition["renderResult"]>>[3];
  const collapsed = tool.renderResult!(result, { expanded: false, isPartial: false }, theme, renderContext)!;
  const expanded = tool.renderResult!(result, { expanded: true, isPartial: false }, theme, renderContext)!;
  assert(collapsed.render(160)[0]?.includes("Assignment: code/auto:high → fixture/large"));
  assert(expanded.render(160).join("\n").includes("resolved only; not executed or applied to the parent"));
  assert(expanded.render(160).join("\n").includes("Selector: llm"));
});

test("routing details sanitize terminal controls and omit arbitrary selector payloads", () => {
  const diagnostics = selectorDiagnostics({ kind: "llm", provider: "fixture", model: "judge", requestedThinking: "low", effectiveThinking: "low", durationMs: 10,
    prompt: "PRIVATE_PROMPT", reasoning: "PRIVATE_REASONING", raw: { secret: "PRIVATE_SECRET" }, usage: { totalTokens: 12, cost: { total: 0.1 } } });
  assert(!JSON.stringify(diagnostics).includes("PRIVATE"));
  const notice: RoutingNotice = { version: 1, kind: "route", source: "user", strategy: "automatic", selection: "wiki/auto:high", target: { provider: "fixture", model: "model\u001b[31m", thinking: "high" }, effectiveThinking: "high", policyRevision: "rev", selector: diagnostics };
  notice.contextSummary = { taskChars: 3000, taskTruncated: true, historyMessages: 2, historyChars: 1000, historyTruncated: true, stateBytes: 4300 };
  const rendered = renderRoutingNotice(notice, true, theme).render(160).join("\n");
  assert(!rendered.includes("\u001b"));
  assert(rendered.includes("task 3000 chars (truncated)"));
  assert(rendered.includes("history 2 messages / 1000 chars (clipped or omitted)"));
  for (const width of [10, 30, 80]) assert(renderRoutingNotice(notice, true, theme).render(width).every(line => visibleWidth(line) <= width));
});
