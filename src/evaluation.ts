import { createHash } from "node:crypto";
import { ABSTAIN, createRouter, parsePolicy, parseSelection, RoutingError } from "./core/index.ts";
import type { Constraints, Policy, PolicyConfig, Target } from "./core/index.ts";
import { freeze, keys, record, snapshot } from "./core/policy.ts";

export const EVALUATOR_VERSION = "1";
export type Split = "tuning" | "holdout";
interface FixtureTarget { inputs: ("text" | "image")[] }
export interface EvaluationCase {
  id: string;
  split: Split;
  tags: string[];
  task: string;
  selection: string;
  constraints?: Constraints;
  unavailable?: string[];
  revoked?: string[];
  acceptableChoices: string[];
}
export interface Corpus {
  version: 1;
  id: string;
  revision: string;
  policy: PolicyConfig;
  inventory: Record<string, FixtureTarget>;
  cases: EvaluationCase[];
}
const FAILURE_CODES = ["SELECTOR_ERROR", "SELECTOR_TIMEOUT", "SELECTOR_UNAVAILABLE", "ABORTED"] as const;
export interface Recording {
  caseId: string;
  response: { kind: "answer"; answer: unknown } | { kind: "error"; code: typeof FAILURE_CODES[number] };
}
export interface AnswerSet {
  version: 1;
  corpusHash: string;
  policyRevision: string;
  selector: { id: string; version: string; origin: "fixture" | "recorded" };
  records: Recording[];
}
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid evaluation artifact: ${message}`);
}
function label(value: unknown): asserts value is string {
  requireValue(typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/.test(value), "identity must be bounded ASCII");
}
function list(value: unknown, max: number): asserts value is string[] {
  requireValue(Array.isArray(value) && value.length <= max && value.every(v => typeof v === "string") && new Set(value).size === value.length, "expected a bounded unique string array");
}
const targetId = (target: Target) => `${target.provider}/${target.model}`;
/** Canonical content hash, not a signature or proof of answer provenance. */
export function artifactHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(snapshot(value, 1_048_576))).digest("hex");
}
function modelAvailable(corpus: Corpus, item: EvaluationCase, target: Target, recheck = false): boolean {
  const id = targetId(target);
  const model = corpus.inventory[id];
  return !!model && !item.unavailable?.includes(id) && !(recheck && item.revoked?.includes(id)) && (item.constraints?.requiredInputs ?? ["text"]).every(input => model.inputs.includes(input));
}
/** Independent fixture oracle: does not derive expected choices from router receipts. */
function offered(corpus: Corpus, policy: Policy, item: EvaluationCase): string[] {
  const [name, effort] = item.selection.split(":");
  const route = policy.automatic[name!];
  if (!route) return [];
  return Object.entries(policy.variants).filter(([choice, target]) =>
    (!route.namespace || choice.split("/")[0] === route.namespace) &&
    (!effort || choice.split(":")[1] === effort) &&
    (!item.constraints?.allowedChoices || item.constraints.allowedChoices.includes(choice)) && modelAvailable(corpus, item, target),
  ).map(([choice]) => choice);
}
export function parseCorpus(input: unknown): Corpus {
  const value = record(snapshot(input, 1_048_576), "corpus");
  keys(value, ["version", "id", "revision", "policy", "inventory", "cases"], "corpus");
  requireValue(value.version === 1, "unsupported corpus version"); label(value.id); label(value.revision);
  const policy = parsePolicy(value.policy);
  const inventory = record(value.inventory, "inventory");
  const targets = new Set(Object.values(policy.variants).map(targetId));
  requireValue(Object.keys(inventory).length <= 192, "too many inventory entries");
  for (const [id, raw] of Object.entries(inventory)) {
    requireValue(targets.has(id), "inventory target not in policy");
    const target = record(raw, "fixture target"); keys(target, ["inputs"], "fixture target"); list(target.inputs, 2);
    requireValue((target.inputs as string[]).every(v => v === "text" || v === "image"), "unsupported input type");
  }
  requireValue(Array.isArray(value.cases) && value.cases.length > 0 && value.cases.length <= 100, "corpus must have 1–100 cases");
  const ids = new Set<string>();
  for (const raw of value.cases) {
    const c = record(raw, "case");
    keys(c, ["id", "split", "tags", "task", "selection", "constraints", "unavailable", "revoked", "acceptableChoices"], "case");
    label(c.id); requireValue(!ids.has(c.id), "duplicate case ID"); ids.add(c.id);
    requireValue(c.split === "tuning" || c.split === "holdout", "invalid split");
    list(c.tags, 12); for (const tag of c.tags) label(tag);
    requireValue(typeof c.task === "string" && c.task.trim() && c.task.length <= 3000, "task must be 1–3000 characters");
    requireValue(typeof c.selection === "string", "selection required");
    const parsed = parseSelection(c.selection, Object.keys(policy.automatic));
    if (parsed.mode === "explicit") requireValue(Object.hasOwn(policy.variants, `${parsed.role}:${parsed.effort ?? policy.config.models[parsed.role]?.defaultEffort}`), "unknown explicit variant");
    if (c.constraints !== undefined) {
      const limits = record(c.constraints, "constraints"); keys(limits, ["allowedChoices", "requiredInputs"], "constraints");
      if (limits.allowedChoices !== undefined) { list(limits.allowedChoices, 192); requireValue(limits.allowedChoices.every(v => Object.hasOwn(policy.variants, v)), "unknown allowed choice"); }
      if (limits.requiredInputs !== undefined) { list(limits.requiredInputs, 2); requireValue(limits.requiredInputs.every(v => v === "text" || v === "image"), "invalid required input"); }
    }
    snapshot({ task: c.task, taskTruncated: false, hasImages: (c.constraints as Constraints | undefined)?.requiredInputs?.includes("image") ?? false }, 16_384);
    for (const field of ["unavailable", "revoked"] as const) if (c[field] !== undefined) { list(c[field], 192); requireValue(c[field].every(v => targets.has(v)), "unknown unavailable/revoked target"); }
    requireValue(parsed.mode === "auto" || !(c.revoked as string[] | undefined)?.length, "revocation requires automatic selection");
    list(c.acceptableChoices, 193);
    requireValue(c.acceptableChoices.every(v => v === ABSTAIN || Object.hasOwn(policy.variants, v)), "unknown suitability label");
  }
  const corpus = value as unknown as Corpus;
  for (const item of corpus.cases) {
    if (parseSelection(item.selection, Object.keys(policy.automatic)).mode === "auto") {
      const choices = offered(corpus, policy, item);
      requireValue(item.acceptableChoices.every(v => v === ABSTAIN || choices.includes(v)), "suitability label is outside initially offered choices");
      requireValue(!choices.length || item.acceptableChoices.length > 0, "automatic case with candidates needs labels");
    }
  }
  return corpus;
}
export function parseAnswers(input: unknown, corpus: Corpus): AnswerSet {
  const value = record(snapshot(input, 1_048_576), "answer set");
  keys(value, ["version", "corpusHash", "policyRevision", "selector", "records"], "answer set");
  requireValue(value.version === 1, "unsupported answer-set version");
  requireValue(value.corpusHash === artifactHash(corpus), "corpus hash mismatch");
  requireValue(value.policyRevision === parsePolicy(corpus.policy).revision, "policy revision mismatch");
  const selector = record(value.selector, "selector provenance"); keys(selector, ["id", "version", "origin"], "selector provenance");
  label(selector.id); label(selector.version); requireValue(selector.origin === "fixture" || selector.origin === "recorded", "invalid answer origin");
  requireValue(Array.isArray(value.records) && value.records.length === corpus.cases.length, "one record per corpus case is required (even for split runs)");
  const ids = new Set(corpus.cases.map(c => c.id));
  for (const raw of value.records) {
    const r = record(raw, "recording"); keys(r, ["caseId", "response"], "recording");
    requireValue(typeof r.caseId === "string" && ids.delete(r.caseId), "unknown or duplicate recording ID");
    const response = record(r.response, "response");
    if (response.kind === "answer") {
      keys(response, ["kind", "answer"], "response"); requireValue(Object.hasOwn(response, "answer"), "answer field missing"); snapshot(response.answer, 65_536);
    } else {
      keys(response, ["kind", "code"], "response");
      requireValue(response.kind === "error" && FAILURE_CODES.includes(response.code as never), "unsupported recorded failure");
    }
  }
  return value as unknown as AnswerSet;
}
function proposed(response: Recording["response"]): string | null {
  if (response.kind !== "answer") return null;
  const route = (response.answer as { answers?: { route?: { type?: unknown; choice?: unknown } } } | null)?.answers?.route;
  return route?.type === "choice" && typeof route.choice === "string" ? route.choice : null;
}
interface Outcome { choice: string | null; error: string | null }
export function mechanicsMatch(actual: Outcome, oracle: Outcome, checks: { requestMatches: boolean; targetMatches: boolean; invoked: boolean; shouldInvoke: boolean }): boolean {
  return actual.choice === oracle.choice && actual.error === oracle.error && checks.requestMatches && checks.targetMatches && checks.invoked === checks.shouldInvoke;
}
function expected(corpus: Corpus, policy: Policy, item: EvaluationCase, response: Recording["response"]): Outcome {
  const [name, effort] = item.selection.split(":");
  if (!policy.automatic[name!]) {
    const choice = `${name}:${effort ?? policy.config.models[name!]!.defaultEffort}`;
    return (!item.constraints?.allowedChoices || item.constraints.allowedChoices.includes(choice)) && modelAvailable(corpus, item, policy.variants[choice]!) ? { choice, error: null } : { choice: null, error: "INELIGIBLE" };
  }
  const choices = offered(corpus, policy, item);
  let error: string | null = null;
  const choice = proposed(response);
  if (!choices.length) error = "NO_CANDIDATES";
  else if (response.kind === "error") error = response.code;
  else if (choice === ABSTAIN) error = "ABSTAINED";
  else if (!choice || !choices.includes(choice)) error = "INVALID_ANSWER";
  else if (!modelAvailable(corpus, item, policy.variants[choice]!, true)) error = "INELIGIBLE";
  return error ? { choice: null, error } : { choice, error: null };
}
/** No provider adapters, ambient config, network, file I/O, or execution dispatch. */
export async function replayEvaluation(corpusInput: unknown, answersInput: unknown, split: Split | "all" = "holdout") {
  requireValue(["tuning", "holdout", "all"].includes(split), "invalid requested split");
  const corpus = parseCorpus(corpusInput);
  const answers = parseAnswers(answersInput, corpus);
  const policy = parsePolicy(corpus.policy);
  const selected = corpus.cases.filter(c => split === "all" || c.split === split);
  requireValue(selected.length > 0, "requested split is empty");
  const byId = new Map(answers.records.map(r => [r.caseId, r.response]));
  const cases: { id: string; split: Split; tags: string[]; actual: Outcome; expected: Outcome; mechanicalPass: boolean; replayedSelectorInvocation: boolean; suitability: boolean | null; suitabilityExclusion: string | null }[] = [];
  for (const item of selected) {
    const response = byId.get(item.id)!;
    let invoked = false;
    let requestMatches = true;
    const allowed = offered(corpus, policy, item);
    const router = createRouter(corpus.policy, target => ({ eligible: modelAvailable(corpus, item, target, invoked), code: "restricted" }));
    let actual: Outcome = { choice: null, error: null };
    let targetMatches = true;
    try {
      const result = await router.select(item.selection, { task: item.task, taskTruncated: false, hasImages: item.constraints?.requiredInputs?.includes("image") ?? false }, {
        identity: { kind: "custom" },
        async select(request) {
          invoked = true;
          requestMatches = artifactHash(request) === artifactHash({
            state: { task: item.task, taskTruncated: false, hasImages: item.constraints?.requiredInputs?.includes("image") ?? false },
            questions: { route: { type: "choice", instructions: policy.config.questions.route.instructions,
              criteria: Object.fromEntries([...allowed, ABSTAIN].map(choice => [choice, policy.config.questions.route.criteria[choice]])) } },
          });
          if (response.kind === "error") throw new RoutingError(response.code, "Recorded offline selector failure");
          return { answer: response.answer };
        },
      }, item.constraints);
      actual = { choice: result.assignment.choice, error: null };
      targetMatches = JSON.stringify(result.assignment.target) === JSON.stringify(policy.variants[result.assignment.choice]);
    } catch (error) {
      if (!(error instanceof RoutingError)) throw error;
      actual = { choice: null, error: error.code };
    }
    const oracle = expected(corpus, policy, item, response);
    const shouldInvoke = !!policy.automatic[item.selection.split(":")[0]!] && allowed.length > 0;
    const mechanicalPass = mechanicsMatch(actual, oracle, { requestMatches, targetMatches, invoked, shouldInvoke });
    const suitability = invoked && response.kind === "answer" ? item.acceptableChoices.includes(proposed(response) ?? "") : null;
    cases.push({ id: item.id, split: item.split, tags: item.tags, actual, expected: oracle, mechanicalPass, replayedSelectorInvocation: invoked, suitability,
      suitabilityExclusion: suitability === null ? (!shouldInvoke ? "explicit_or_no_candidates" : "recorded_selector_failure") : null });
  }
  const summarize = (rows: typeof cases) => {
    const scored = rows.filter(r => r.suitability !== null);
    return { cases: rows.length, mechanicalPassed: rows.filter(r => r.mechanicalPass).length, mechanicalFailed: rows.filter(r => !r.mechanicalPass).length,
      replayedSelectorInvocations: rows.filter(r => r.replayedSelectorInvocation).length,
      suitability: { scored: scored.length, accepted: scored.filter(r => r.suitability).length, rejected: scored.filter(r => !r.suitability).length, unscored: rows.length - scored.length, rate: scored.length ? scored.filter(r => r.suitability).length / scored.length : null } };
  };
  return freeze({ version: 1, evaluatorVersion: EVALUATOR_VERSION, mode: "offline-replay", liveInference: false,
    corpus: { id: corpus.id, revision: corpus.revision, hash: artifactHash(corpus) }, policyRevision: policy.revision,
    answers: { hash: artifactHash(answers), selector: answers.selector }, split, summary: summarize(cases),
    splits: { tuning: summarize(cases.filter(c => c.split === "tuning")), holdout: summarize(cases.filter(c => c.split === "holdout")) }, cases,
    notes: ["Mechanics checks the router against an independent fixture oracle, including expected rejection; it is not selector answer accuracy.", "Suitability scores recorded returned proposals, including malformed/unoffered answers as misses. Explicit routes, empty candidate sets and recorded selector failures are unscored. Revoked proposals are still scored against initial labels.", "Fixture answers are hand-authored tests, not measured selector quality. Public holdout is a regression split, not a blind benchmark.", "No network, generation, cost or latency measurement. Provenance hashes bind content, not authenticity. Task text and raw answers remain in separate input artifacts, not this report or ordinary receipts."] });
}
