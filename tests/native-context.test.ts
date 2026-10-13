import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNativeContext, projectedDialogue } from "../src/native-context.ts";
import { parsePolicy, RoutingError } from "../src/core/index.ts";
import { config } from "./fixtures.ts";
const error = (code: string) => (e: unknown) => e instanceof RoutingError && e.code === code;
const user = (content: string, timestamp = 1) => ({ role: "user", content, timestamp });
const assistant = (content: string, timestamp = 2) => ({ role: "assistant", content, timestamp });

test("native context options are strict, bounded, immutable and revisioned without changing old policies", () => {
  const base = parsePolicy(config());
  for (const nativeRouting of [null, { unknown: true }, { affinity: "task" }, { context: false },
    { context: { includeAssistant: 1 } }, { context: { previousMessages: -1 } }, { context: { previousMessages: 9 } },
    { context: { previousMessages: 1.5 } }, { context: { maxHistoryChars: 8001 } }, { context: { maxMessageChars: 127 } },
    { context: { maxMessageChars: 3001 } }, { context: { truncation: "silent" } }, { context: { truncation: ["prefix"] } },
    { context: { toolResults: true } }]) {
    assert.throws(() => parsePolicy({ ...config(), nativeRouting }), error("INVALID_CONFIG"), JSON.stringify(nativeRouting));
  }
  const p = parsePolicy({ ...config(), nativeRouting: { affinity: "session", context: { includeAssistant: true } } });
  assert.notEqual(p.revision, base.revision);
  assert(Object.isFrozen(p.config.nativeRouting?.context));
  assert.equal(parsePolicy(config()).revision, base.revision);
});

test("default context retains latest-user prefix and legacy state shape, with no dialogue", () => {
  const input = "start" + "x".repeat(4000) + "CRITICAL_SUFFIX";
  const { state, summary } = buildNativeContext([user("old"), assistant("plan"), user(input)], true);
  assert.deepEqual(state, { task: input.slice(0, 3000), taskTruncated: true, hasImages: true });
  assert.equal(summary.historyMessages, 0);
  assert.throws(() => buildNativeContext([assistant("not a user task")], false, {}), error("INVALID_STATE"));
});

test("opt-in user/assistant window explains approval, preserves chronology and defaults to user-only", () => {
  const messages = [user("OLDER"), user("Review authentication", 3), assistant("Implement plan B: preserve tenant isolation", 4), user("yes, proceed", 5)];
  const context = buildNativeContext(messages, false, { previousMessages: 2, includeAssistant: true });
  assert.equal(context.state.task, "yes, proceed");
  assert.deepEqual(context.state.recentDialogue, [
    { role: "user", text: "Review authentication", truncated: false },
    { role: "assistant", text: "Implement plan B: preserve tenant isolation", truncated: false },
  ]);
  assert.equal(context.state.dialogueTruncated, true);
  assert(buildNativeContext(messages, false, {}).state.recentDialogue!.every(m => m.role === "user"));
  assert.deepEqual(buildNativeContext(messages, false, { previousMessages: 0 }).state.recentDialogue, []);
  assert.deepEqual(buildNativeContext(messages, false, { maxHistoryChars: 0 }).state.recentDialogue, []);
});

test("only projected dialogue is admitted: no system, tool, thinking, custom or summary text", () => {
  const real = [user("human task"), { role: "assistant", timestamp: 2, content: [
    { type: "thinking", thinking: "SECRET_THOUGHT" }, { type: "toolCall", name: "shell", arguments: { secret: "SECRET_ARGUMENT" } },
    { type: "text", text: "visible plan" }, { type: "image", data: "SECRET_IMAGE" },
  ] }];
  const synthetic = [
    { role: "custom", timestamp: 3, content: "SECRET_GUIDANCE" },
    { role: "compactionSummary", timestamp: 4, summary: "SECRET_SUMMARY" },
    { role: "bashExecution", timestamp: 5, output: "SECRET_SHELL" },
  ];
  const request = [...real, ...synthetic.map(m => user(JSON.stringify(m), m.timestamp)),
    { role: "toolResult", content: "SECRET_TOOL" }, { role: "system", content: "SECRET_SYSTEM" }, user("yes", 9)];
  const admitted = projectedDialogue(request, [...real, ...synthetic, user("yes", 9)]);
  const { state } = buildNativeContext(admitted, false, { includeAssistant: true });
  assert(!JSON.stringify(state).includes("SECRET"));
  assert.equal(state.recentDialogue?.at(-1)?.text, "visible plan");
  assert.equal(state.task, "yes");
  // Raw session messages absent from the current projection cannot be recovered.
  assert.deepEqual(projectedDialogue([user("compacted-away")], [user("retained", 7)]), []);
});

test("head-tail preserves a critical suffix, prefix is explicit, strict mode rejects truncation", () => {
  const text = "GOAL " + "x".repeat(4000) + " MUST PRESERVE TENANT ISOLATION";
  const headTail = buildNativeContext([user(text)], false, {});
  assert(headTail.state.task.startsWith("GOAL"));
  assert(headTail.state.task.endsWith("MUST PRESERVE TENANT ISOLATION"));
  assert(headTail.state.task.includes("…"));
  assert.equal(headTail.state.taskTruncated, true);
  assert(!buildNativeContext([user(text)], false, { truncation: "prefix" }).state.task.includes("TENANT"));
  assert.throws(() => buildNativeContext([user(text)], false, { truncation: "error" }), error("INVALID_STATE"));
  assert.throws(() => buildNativeContext([user("x".repeat(200)), user("yes")], false, { maxHistoryChars: 100, truncation: "error" }), error("INVALID_STATE"));
});

test("history budgets prioritize newest dialogue, mark partial excerpts and exclude later assistant text", () => {
  const { state, summary } = buildNativeContext([user("old"), assistant("newest plan"), user("yes"), assistant("not prior dialogue", 8)], false,
    { includeAssistant: true, maxHistoryChars: 6 });
  assert.deepEqual(state.recentDialogue, [{ role: "assistant", text: "new…an", truncated: true }]);
  assert.equal(summary.historyChars, 6);
  assert.equal(summary.historyTruncated, true);
  assert.equal(summary.taskChars, 3);
  assert.equal(summary.stateBytes, Buffer.byteLength(JSON.stringify(state)));
});

test("Unicode and escaped text remain within both character and serialized byte budgets", () => {
  for (const sample of ["😀", "漢", "\u0000", "\\\"\n", "x"]) {
    for (const truncation of ["head-tail", "prefix"] as const) {
      const messages = Array.from({ length: 10 }, (_, i) => user(sample.repeat(6000), i));
      const { state, summary } = buildNativeContext(messages, false, { previousMessages: 8, truncation });
      assert(summary.stateBytes <= 16384, `${sample} / ${truncation}: ${summary.stateBytes}`);
      assert(summary.historyChars <= 8000);
      assert(state.task.length <= 3000);
      assert(!/[\uD800-\uDFFF]/u.test(state.task));
      assert(state.recentDialogue!.every(m => m.text.length <= 3000 && !/[\uD800-\uDFFF]/u.test(m.text)));
      assert.equal(summary.taskTruncated, true);
    }
  }
  assert.throws(() => buildNativeContext([user("\u0000".repeat(3000))], false, { truncation: "error" }), error("INVALID_STATE"));
});
