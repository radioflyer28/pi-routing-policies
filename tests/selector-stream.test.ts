import assert from "node:assert/strict";
import { test } from "node:test";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { createLlmSelector } from "../src/llm.ts";
import { createRouter, RoutingError } from "../src/core/index.ts";
import { available, config } from "./fixtures.ts";
import { fixture, zeroCost } from "./sdk-fixture.ts";

test("LLM streaming limits stop oversized output and unauthorized tool output before waiting for completion", async t => {
  const f = await fixture(t);
  const request = (await createRouter(config(), available).prepare("virt/auto", {})).request;
  for (const type of ["text_delta", "toolcall_start"] as const) {
    let signal: AbortSignal | undefined;
    const model = f.ctx.modelRegistry.find("fixture", "judge-llm")!;
    const selector = createLlmSelector({
      find: () => model,
      hasConfiguredAuth: () => true,
      streamSimple: (_model, _context, options) => {
        signal = options?.signal;
        const stream = createAssistantMessageEventStream();
        const partial = { role: "assistant" as const, api: model.api, model: model.id, provider: model.provider, timestamp: 0, content: [], stopReason: "pending" as const,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { ...zeroCost, total: 0 } } };
        queueMicrotask(() => {
          stream.push(type === "text_delta" ? { type, contentIndex: 0, delta: "x".repeat(65537), partial } : { type, contentIndex: 0, partial });
          // Deliberately no end event. The adapter must stop waiting and cancel.
        });
        return stream;
      },
    }, { kind: "llm", provider: "fixture", model: "judge-llm", thinking: "off", timeoutMs: 1000 });
    await assert.rejects(selector.select(request), e => e instanceof RoutingError && e.code === "INVALID_ANSWER");
    assert(signal?.aborted);
  }
});
