import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { artifactHash, mechanicsMatch, parseAnswers, parseCorpus, replayEvaluation } from "../src/evaluation.ts";
const corpus = JSON.parse(await readFile(new URL("../evaluation/corpus-v1.json", import.meta.url), "utf8"));
const answers = JSON.parse(await readFile(new URL("../evaluation/answers-fixture-v1.json", import.meta.url), "utf8"));
const clone = <T>(value: T): T => structuredClone(value);

test("frozen 40-case corpus has distinct public tuning/holdout sets and bound artifacts", () => {
  const parsed = parseCorpus(corpus);
  assert.equal(parsed.cases.length, 40);
  assert.equal(parsed.cases.filter(c => c.split === "tuning").length, 20);
  assert.equal(parsed.cases.filter(c => c.split === "holdout").length, 20);
  assert.equal(artifactHash(parsed), "f5a54d821c130bdc591d5035a0eb33fffc5666bccf26874ed77fb1e6008f5d0f");
  assert(Object.isFrozen(parsed.cases[0]));
  assert.equal(parseAnswers(answers, parsed).selector.origin, "fixture");
  assert.equal(artifactHash({ a: 1, b: 2 }), artifactHash({ b: 2, a: 1 }));
});

test("replay separates fail-closed mechanics from suitability and exposes all denominators", async () => {
  const result = await replayEvaluation(corpus, answers, "all");
  assert.equal(result.summary.cases, 40);
  assert.equal(result.summary.mechanicalPassed, 40);
  assert.equal(result.summary.mechanicalFailed, 0);
  assert.equal(result.summary.replayedSelectorInvocations, 31);
  assert.deepEqual(result.summary.suitability, { scored: 28, accepted: 19, rejected: 9, unscored: 12, rate: 19 / 28 });
  const item = (id: string) => result.cases.find(c => c.id === id)!;
  assert.equal(item("t09").actual.error, "INVALID_ANSWER");
  assert.equal(item("t09").mechanicalPass, true);
  assert.equal(item("t09").suitability, false);
  assert.equal(item("t02").actual.choice, "wiki/edit:low");
  assert.equal(item("t02").suitability, false);
  assert.equal(item("t18").actual.error, "INELIGIBLE");
  assert.equal(item("t18").suitability, true);
  assert.equal(item("t15").replayedSelectorInvocation, false);
  assert.equal(item("t20").suitability, null);
  assert.equal(item("t13").replayedSelectorInvocation, false);
  assert.equal(item("t10").actual.error, "INVALID_ANSWER");
  assert.equal(item("t11").actual.error, "INVALID_ANSWER");
  assert.equal(item("h13").actual.error, "INELIGIBLE");
  assert.equal(item("h17").actual.error, "INELIGIBLE");
});

test("mechanical grading rejects wrong outcomes, target/request drift and invocation mismatches", () => {
  const outcome = { choice: "wiki/edit:high", error: null };
  const checks = { requestMatches: true, targetMatches: true, invoked: true, shouldInvoke: true };
  assert.equal(mechanicsMatch(outcome, outcome, checks), true);
  assert.equal(mechanicsMatch({ choice: "wiki/edit:low", error: null }, outcome, checks), false);
  assert.equal(mechanicsMatch({ choice: null, error: "INVALID_ANSWER" }, outcome, checks), false);
  for (const field of ["requestMatches", "targetMatches", "invoked", "shouldInvoke"] as const) assert.equal(mechanicsMatch(outcome, outcome, { ...checks, [field]: false }), false);
});

test("default holdout and explicit tuning runs do not mix score populations", async () => {
  const holdout = await replayEvaluation(corpus, answers);
  const tuning = await replayEvaluation(corpus, answers, "tuning");
  assert.equal(holdout.summary.cases, 20);
  assert(holdout.cases.every(c => c.split === "holdout"));
  assert.equal(holdout.splits.tuning.cases, 0);
  assert.equal(holdout.splits.tuning.suitability.rate, null);
  assert.equal(tuning.summary.cases, 20);
  assert(tuning.cases.every(c => c.split === "tuning"));
  await assert.rejects(replayEvaluation(corpus, answers, "wrong" as never), /invalid requested split/);
});

test("report is deterministic, immutable, non-mutating and excludes task/raw-answer payloads", async () => {
  const before = JSON.stringify({ corpus, answers });
  const changed = clone(answers);
  changed.records[0].response.answer.extra = "PRIVATE_RAW_PROVIDER_PAYLOAD";
  const first = await replayEvaluation(corpus, changed, "all");
  assert.deepEqual(first, await replayEvaluation(corpus, changed, "all"));
  assert(Object.isFrozen(first.cases[0]));
  const text = JSON.stringify(first);
  assert(!text.includes(corpus.cases[0].task));
  assert(!text.includes("PRIVATE_RAW_PROVIDER_PAYLOAD"));
  assert(!text.includes("startedAt"));
  assert.equal(first.liveInference, false);
  assert.equal(before, JSON.stringify({ corpus, answers }));
});

test("changed inputs, policy, answers or incomplete coverage cannot silently reuse provenance", () => {
  const changed = clone(corpus); changed.cases[0].task += " changed";
  assert.throws(() => parseAnswers(answers, parseCorpus(changed)), /corpus hash mismatch/);
  const policyMismatch = clone(answers); policyMismatch.policyRevision = "wrong";
  assert.throws(() => parseAnswers(policyMismatch, parseCorpus(corpus)), /policy revision mismatch/);
  const missing = clone(answers); missing.records.pop();
  assert.throws(() => parseAnswers(missing, parseCorpus(corpus)), /one record per corpus case/);
  const duplicate = clone(answers); duplicate.records[1].caseId = duplicate.records[0].caseId;
  assert.throws(() => parseAnswers(duplicate, parseCorpus(corpus)), /duplicate recording ID/);
  const swapped = clone(answers); swapped.records[0].caseId = "unknown";
  assert.throws(() => parseAnswers(swapped, parseCorpus(corpus)), /unknown or duplicate/);
});

test("artifact validators reject unknown schema fields, impossible labels and oversized input", () => {
  const duplicate = clone(corpus); duplicate.cases[1].id = duplicate.cases[0].id;
  assert.throws(() => parseCorpus(duplicate), /duplicate case ID/);
  const label = clone(corpus); label.cases[8].acceptableChoices = ["wiki/edit:low"];
  assert.throws(() => parseCorpus(label), /outside initially offered/);
  const task = clone(corpus); task.cases[0].task = "x".repeat(3001);
  assert.throws(() => parseCorpus(task), /1–3000/);
  const escaped = clone(corpus); escaped.cases[0].task = String.fromCharCode(1).repeat(3000);
  assert.throws(() => parseCorpus(escaped), /byte limit/);
  assert.throws(() => parseCorpus({ ...corpus, apiKey: "secret" }), /unknown field/);
  const unknown = clone(answers); unknown.records[0].response = { kind: "error", code: "MADE_UP" };
  assert.throws(() => parseAnswers(unknown, parseCorpus(corpus)), /unsupported recorded failure/);
  const oversized = clone(answers); oversized.records[0].response.answer = "x".repeat(65537);
  assert.throws(() => parseAnswers(oversized, parseCorpus(corpus)), /byte limit/);
});

test("changing a recorded proposal changes suitability without weakening constraint enforcement", async () => {
  const changed = clone(answers);
  changed.records[0].response.answer.answers.route.choice = "code/review:high";
  const result = await replayEvaluation(corpus, changed, "tuning");
  assert.equal(result.cases[0]?.actual.choice, "code/review:high");
  assert.equal(result.cases[0]?.mechanicalPass, true);
  assert.equal(result.cases[0]?.suitability, false);
  assert.notEqual(result.answers.hash, artifactHash(answers));
  const invalid = clone(answers);
  invalid.records[0].response.answer.answers.route.choice = "invented/model:low";
  const rejected = await replayEvaluation(corpus, invalid, "tuning");
  assert.equal(rejected.cases[0]?.actual.error, "INVALID_ANSWER");
  assert.equal(rejected.cases[0]?.mechanicalPass, true);
  assert.equal(rejected.cases[0]?.suitability, false);
  const image = clone(answers);
  image.records.find((r: any) => r.caseId === "t12").response.answer.answers.route.choice = "wiki/edit:low";
  const imageCase = (await replayEvaluation(corpus, image, "tuning")).cases.find(c => c.id === "t12")!;
  assert.equal(imageCase.actual.error, "INVALID_ANSWER");
  assert.equal(imageCase.mechanicalPass, true);
});

test("zero suitability population remains null and unavailable recordings remain unscored", async () => {
  const explicit = clone(corpus); explicit.cases = [explicit.cases.find((c: any) => c.id === "t15")];
  const recording = clone(answers); recording.records = [recording.records.find((r: any) => r.caseId === "t15")]; recording.corpusHash = artifactHash(explicit);
  const result = await replayEvaluation(explicit, recording, "all");
  assert.equal(result.summary.suitability.scored, 0);
  assert.equal(result.summary.suitability.rate, null);
  assert.equal(result.summary.suitability.unscored, 1);
  await assert.rejects(replayEvaluation(explicit, recording), /requested split is empty/);
  const unavailable = clone(answers);
  unavailable.records.find((r: any) => r.caseId === "h20").response = { kind: "error", code: "SELECTOR_UNAVAILABLE" };
  const row = (await replayEvaluation(corpus, unavailable)).cases.find(c => c.id === "h20")!;
  assert.equal(row.actual.error, "SELECTOR_UNAVAILABLE");
  assert.equal(row.mechanicalPass, true);
  assert.equal(row.suitability, null);
});

test("CLI works without credentials, rejects live options, bounds files and never overwrites output", async t => {
  const dir = await mkdtemp(join(tmpdir(), "vm-evaluation-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cli = resolve("scripts/evaluate.mjs");
  const env: NodeJS.ProcessEnv = {};
  for (const name of ["SystemRoot", "WINDIR", "TEMP", "TMP"]) if (process.env[name]) env[name] = process.env[name];
  const run = (...args: string[]) => promisify(execFile)(process.execPath, ["--experimental-strip-types", cli, ...args], { cwd: dir, env, timeout: 15000, maxBuffer: 2_000_000 });
  const { stdout } = await run();
  const report = JSON.parse(stdout);
  assert.equal(report.summary.cases, 20);
  assert.equal(report.liveInference, false);
  assert.match(report.runner.implementationHash, /^[a-f0-9]{64}$/);
  assert(report.runner.sources.includes("src/core/index.ts"));
  assert.equal(report.runner.node, process.version);
  await assert.rejects(run("--live"), (e: any) => e.code === 2);
  await assert.rejects(run("--split", "all", "--split", "holdout"), (e: any) => e.code === 2);
  const output = join(dir, "report.json");
  await run("--split", "all", "--out", output);
  assert.equal(JSON.parse(await readFile(output, "utf8")).summary.mechanicalPassed, 40);
  const prior = await readFile(output, "utf8");
  await assert.rejects(run("--out", output), (e: any) => e.code === 2 && e.stderr.includes("EEXIST"));
  assert.equal(await readFile(output, "utf8"), prior);
  const big = join(dir, "large.json"); await writeFile(big, " ".repeat(1_048_577));
  await assert.rejects(run("--answers", big), (e: any) => e.code === 2 && e.stderr.includes("1 MiB"));
});
