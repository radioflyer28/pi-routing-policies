import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { ClassifierResult } from "@earendil-works/pi-ai";
import { createClassifierSelector } from "../src/classifier.ts";
import { createRouter, RoutingError } from "../src/core/index.ts";
import { config, available } from "./fixtures.ts";
const error = (code: string) => (e: unknown) => e instanceof RoutingError && e.code === code;
const success: ClassifierResult = { api: "fixture-classify", timestamp: 0, provider: "fixture", model: "judge", stopReason: "stop", answers: {
  route: { type: "choice", choice: "wiki/edit:high", confidence: 0.9, probabilities: { "wiki/edit:high": 0.9 } },
}, usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { input: 0.001, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.001 } } };
function client(classify: Pick<ModelRegistry, "classify">["classify"], found = true): Pick<ModelRegistry, "findOfType" | "classify"> {
  return { findOfType: (() => found ? { provider: "fixture", id: "judge", type: "classifier" } : undefined) as ModelRegistry["findOfType"], classify };
}

test("Jev adapter passes the exact request, normalizes choice, and reports usage/diagnostics", async () => {
  const router = createRouter(config(), available);
  const decision = await router.prepare("virt/auto:high", { task: "review" });
  let observed: unknown;
  const selector = createClassifierSelector(client(async (_model, request, options) => {
    assert.equal(request, decision.request);
    assert(options?.signal);
    return success;
  }), config().selector!, metadata => { observed = metadata; });
  const result = await selector.select(decision.request);
  assert.equal(result.metadata?.confidence, 0.9);
  assert.deepEqual(result.metadata?.usage, success.usage);
  assert.equal(observed, result.metadata);
  assert.equal((await router.accept(decision, result.answer)).choice, "wiki/edit:high");
});

test("classifier errors, missing models and malformed responses never select a fallback", async () => {
  const request = (await createRouter(config(), available).prepare("virt/auto", {})).request;
  await assert.rejects(createClassifierSelector(client(async () => success, false), config().selector!).select(request), error("SELECTOR_UNAVAILABLE"));
  for (const result of [{ ...success, stopReason: "error" as const, errorMessage: "secret-token" }, { ...success, stopReason: "aborted" as const }]) {
    await assert.rejects(createClassifierSelector(client(async () => result), config().selector!).select(request), error(result.stopReason === "error" ? "SELECTOR_ERROR" : "ABORTED"));
  }
  await assert.rejects(createClassifierSelector(client(async () => { throw new Error("secret-token"); }), config().selector!).select(request), e => {
    assert(e instanceof RoutingError); assert.equal(e.code, "SELECTOR_ERROR"); assert(!e.message.includes("secret-token")); return true;
  });
});

test("timeout bounds even an uncooperative provider and forwards cancellation", async () => {
  const request = (await createRouter(config(), available).prepare("virt/auto", {})).request;
  let innerSignal: AbortSignal | undefined;
  const selector = createClassifierSelector(client(async (_m, _r, options) => {
    innerSignal = options?.signal;
    return new Promise(() => {});
  }), { ...config().selector!, timeoutMs: 15 });
  await assert.rejects(selector.select(request), error("SELECTOR_TIMEOUT"));
  assert(innerSignal?.aborted);
  const controller = new AbortController();
  const pending = createClassifierSelector(client(async () => new Promise(() => {})), config().selector!).select(request, controller.signal);
  controller.abort();
  await assert.rejects(pending, error("ABORTED"));
  await assert.rejects(selector.select(request, AbortSignal.abort()), error("ABORTED"));
});
