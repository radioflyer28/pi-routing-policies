import { open, writeFile, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { replayEvaluation } from "../src/evaluation.ts";

const root = resolve(import.meta.dirname, "..");
const help = "Offline replay only: npm run evaluate -- [--split tuning|holdout|all] [--corpus FILE] [--answers FILE] [--out NEW_FILE]\nDefaults: bundled corpus/fixture answers, holdout split. No live mode. Exit 0: mechanics passed (not suitability); 1: mechanical mismatch; 2: invalid input/output. Output files must not already exist.";
async function readJson(file) {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(1_048_577);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await handle.read(buffer, count, buffer.length - count, null);
      if (!bytesRead) break;
      count += bytesRead;
    }
    if (count > 1_048_576) throw new Error("Invalid evaluation artifact: file exceeds 1 MiB");
    try { return JSON.parse(buffer.subarray(0, count).toString("utf8")); }
    catch { throw new Error("Invalid evaluation artifact: invalid JSON"); }
  } finally { await handle.close(); }
}
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") console.log(help);
  else {
    const options = new Map();
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i], value = args[i + 1];
      if (!["--corpus", "--answers", "--split", "--out"].includes(key) || !value || value.startsWith("--") || options.has(key)) throw new Error("Invalid evaluation artifact: invalid or duplicate CLI option; use --help");
      options.set(key, value);
    }
    const corpus = await readJson(options.get("--corpus") ?? resolve(root, "evaluation/corpus-v1.json"));
    const answers = await readJson(options.get("--answers") ?? resolve(root, "evaluation/answers-fixture-v1.json"));
    const result = await replayEvaluation(corpus, answers, options.get("--split") ?? "holdout");
    const sources = ["src/evaluation.ts", "scripts/evaluate.mjs", ...(await readdir(resolve(root, "src/core"))).filter(name => name.endsWith(".ts")).map(name => `src/core/${name}`)].sort();
    const hash = createHash("sha256");
    for (const file of sources) { hash.update(file + "\0"); hash.update(await readFile(resolve(root, file))); hash.update("\0"); }
    const report = { ...result, runner: { node: process.version, implementationHash: hash.digest("hex"), sources } };
    const output = JSON.stringify(report, null, 2) + "\n";
    if (options.has("--out")) await writeFile(options.get("--out"), output, { flag: "wx", encoding: "utf8" });
    else process.stdout.write(output);
    process.exitCode = report.summary.mechanicalFailed ? 1 : 0;
  }
} catch (error) {
  const detail = error instanceof Error && error.message.startsWith("Invalid evaluation artifact:") ? error.message : `Artifact validation or file operation failed (${error?.code ?? "INVALID_INPUT"})`;
  console.error(detail.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, 512));
  process.exitCode = 2;
}
