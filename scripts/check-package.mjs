import assert from "node:assert/strict";
import { readFile, readdir, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { createRouter, parsePolicy } from "../dist/core/index.js";
import { replayEvaluation } from "../dist/evaluation.js";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
assert.equal(manifest.private, true, "Publishing must remain an explicit decision");
assert.equal(manifest.license, "Apache-2.0");
assert((await readFile(resolve(root, "LICENSE"), "utf8")).includes("Version 2.0, January 2004"), "Include the Apache 2.0 license text");
assert(!manifest.dependencies, "Host Pi packages must not be bundled as runtime dependencies");
for (const entry of Object.values(manifest.exports)) {
  await access(resolve(root, entry.types));
  await import(pathToFileURL(resolve(root, entry.import)).href);
}
for (const file of await readdir(resolve(root, "dist/core"))) {
  if (!file.endsWith(".js")) continue;
  const source = await readFile(resolve(root, "dist/core", file), "utf8");
  assert(!source.includes("@earendil-works"), "Core runtime must not import Pi");
}
const config = JSON.parse(await readFile(resolve(root, "examples/virtual-models.json"), "utf8"));
const policy = parsePolicy(config);
assert.equal(Object.keys(policy.variants).length, 6);
assert.equal(Object.keys(policy.automatic).length, 3);
assert.equal(policy.automatic["wiki/auto"].selector.kind, "classifier");
assert.equal(policy.automatic["code/auto"].selector.kind, "llm");
const router = createRouter(config, () => ({ eligible: true }));
assert.equal((await router.resolve("wiki/edit")).choice, "wiki/edit:medium");
async function markdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await markdownFiles(file));
    else if (entry.name.endsWith(".md")) files.push(file);
  }
  return files;
}
let blocks = 0;
assert.deepEqual(manifest.pi.skills, ["./skills"]);
const advisorSkill = await readFile(resolve(root, "skills/routing-policy-advisor/SKILL.md"), "utf8");
assert(advisorSkill.replace(/\r\n/g, "\n").startsWith("---\nname: routing-policy-advisor\n"));
const loadedSkills = loadSkillsFromDir({ dir: resolve(root, "skills"), source: "package-check" });
assert.deepEqual(loadedSkills.diagnostics, [], "Bundled skills must load without diagnostics");
assert.deepEqual(loadedSkills.skills.map(skill => skill.name), ["routing-policy-advisor"]);
for (const phrase of ["frontier", "yes accepts", "shared understanding", "domain_modeling", "advisor apply", "[research.md](research.md)", "research status (completed, partial, skipped or unavailable)"]) assert(advisorSkill.includes(phrase), `Advisor skill missing ${phrase}`);
// Structural contract checks, not proof that a live assistant follows the workflow.
const research = await readFile(resolve(root, "skills/routing-policy-advisor/research.md"), "utf8");
for (const heading of ["1. Agree scope and consent", "2. Protect the user's context", "3. Gather task-relevant evidence", "4. Return a small shortlist to the interview", "Completion and checks"]) assert(research.includes(`## ${heading}`), `Research workflow missing ${heading}`);
for (const phrase of ["Skip/unavailable path", "paid model testing", "untrusted evidence", "date accessed", "anecdotal", "unverified", "insufficient", "reconfirm shared understanding"]) assert(research.includes(phrase), `Research guardrail missing ${phrase}`);
for (const file of ["README.md", ...await markdownFiles("docs"), ...await markdownFiles("skills")]) {
  const source = await readFile(resolve(root, file), "utf8");
  assert.equal((source.match(/^```/gm) ?? []).length % 2, 0, `${file}: code fences`);
  for (const match of source.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)) {
    const value = JSON.parse(match[1]);
    if (value.version === 1) parsePolicy(value);
    blocks++;
  }
  for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
    if (/^(https?:|#)/.test(match[1])) continue;
    const target = resolve(root, dirname(file), match[1].split("#")[0]);
    const rel = relative(root, target);
    // Explicitly documented sibling-repo research links are not package requirements.
    if (rel.startsWith("..") || isAbsolute(rel)) continue;
    await access(target);
  }
}
const corpus = JSON.parse(await readFile(resolve(root, "evaluation/corpus-v1.json"), "utf8"));
const answers = JSON.parse(await readFile(resolve(root, "evaluation/answers-fixture-v1.json"), "utf8"));
const evaluation = await replayEvaluation(corpus, answers, "all");
assert.equal(evaluation.summary.cases, 40);
assert.equal(evaluation.summary.mechanicalFailed, 0, "Built offline evaluator must preserve fixture constraints");
const npm = process.env.npm_execpath;
assert(npm, "Run this check through npm run verify");
const packed = JSON.parse(execFileSync(process.execPath, [npm, "pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
const paths = packed[0].files.map(file => file.path);
for (const expected of ["skills/routing-policy-advisor/SKILL.md", "skills/routing-policy-advisor/policy-reference.md", "skills/routing-policy-advisor/research.md", "skills/routing-policy-advisor/SOURCES.md", "skills/routing-policy-advisor/LICENSE", "src/advisor.ts", "dist/advisor.js", "src/advisor-store.ts", "docs/ADVISOR.md", "LICENSE", "dist/core/index.js", "dist/core/index.d.ts", "dist/classifier.js", "dist/llm.js", "dist/selectors.js", "src/routing-notice.ts", "src/execution-context.ts", "src/native-context.ts", "dist/native-context.js", "src/native-capacity.ts", "dist/native-capacity.js", "dist/core/capacity.js", "docs/CAPACITY.md", "docs/adr/0002-capacity-is-admission-not-execution.md", "src/extension.ts", "docs/adr/0001-bounded-dialogue-and-affinity.md", "examples/virtual-models.json", "docs/IMPLEMENTATION.md", "dist/evaluation.js", "src/evaluation.ts", "scripts/evaluate.mjs", "evaluation/corpus-v1.json", "evaluation/answers-fixture-v1.json"]) assert(paths.includes(expected), `Missing package file: ${expected}`);
assert(!paths.some(file => /(^|\/)(node_modules|tests|\.env|auth\.json)(\/|$)/.test(file)), "Unexpected development or credential material in package");
console.log(`PASS: built exports, side-effect-free core dependency graph, ${blocks} JSON documentation blocks, all local documentation links, 40 built offline replay cases, and ${paths.length} package files.`);
