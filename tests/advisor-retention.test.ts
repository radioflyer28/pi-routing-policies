import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { readPolicyFile, writePolicyFile } from "../src/advisor-store.ts";
import { RoutingError } from "../src/core/index.ts";
import { config } from "./fixtures.ts";

const setup = async (t: import("node:test").TestContext) => {
  const dir = await mkdtemp(join(tmpdir(), "advisor-retention-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "policy.json");
  await writeFile(file, JSON.stringify(config()));
  return { dir, file };
};

test("successful applies keep the newest backup plus nine prior backups, ignoring unrelated files and directories", async t => {
  const { dir, file } = await setup(t);
  const unrelated = ["policy.json.advisor-manual.bak", `other.json.advisor-${randomUUID()}.bak`];
  for (const name of unrelated) await writeFile(join(dir, name), "preserve");
  const directory = `policy.json.advisor-${randomUUID()}.bak`;
  await mkdir(join(dir, directory));
  // A symlink is not a regular backup, even when its name matches exactly.
  const link = `policy.json.advisor-${randomUUID()}.bak`;
  fs.symlinkSync(join(dir, directory), join(dir, link), "junction");
  const backups: string[] = [];
  for (let i = 0; i < 12; i++) {
    const before = await readFile(file, "utf8");
    const base = config();
    const next = { ...base, questions: { route: { ...base.questions.route, instructions: `Revision ${i}` } } };
    const result = writePolicyFile(file, readPolicyFile(file).fingerprint, next);
    assert.equal(result.backupCleanupWarning, undefined);
    assert(result.backup);
    assert.equal(await readFile(result.backup, "utf8"), before);
    backups.push(basename(result.backup));
    // Future mtimes must not cause the next newly-created backup to be pruned.
    const time = new Date(Date.UTC(2100, 0, 1) + i * 1000);
    await utimes(result.backup, time, time);
  }
  const names = await readdir(dir);
  assert.deepEqual(names.filter(name => backups.includes(name)).sort(), backups.slice(-10).sort());
  for (const name of unrelated) assert.equal(await readFile(join(dir, name), "utf8"), "preserve");
  assert(fs.lstatSync(join(dir, directory)).isDirectory());
  assert(fs.lstatSync(join(dir, link)).isSymbolicLink());
  assert(!names.some(name => name.endsWith(".tmp") || name.endsWith(".lock")));
});

test("failed apply never prunes recovery backups", async t => {
  const { dir, file } = await setup(t);
  for (let i = 0; i < 12; i++) await writeFile(`${file}.advisor-${randomUUID()}.bak`, `backup ${i}`);
  const names = (await readdir(dir)).sort();
  const before = await readFile(file, "utf8");
  assert.throws(() => writePolicyFile(file, "stale", config()), e => e instanceof RoutingError && e.code === "STALE_DECISION");
  assert.deepEqual((await readdir(dir)).sort(), names);
  assert.equal(await readFile(file, "utf8"), before);
});

test("cleanup failure warns without turning a committed policy into an apply failure", async t => {
  const { dir, file } = await setup(t);
  const before = await readFile(file, "utf8");
  const expected = readPolicyFile(file).fingerprint;
  const base = config();
  const next = { ...base, questions: { route: { ...base.questions.route, instructions: "Committed despite cleanup failure" } } };
  const mock = t.mock.method(fs, "readdirSync", () => { throw new Error("Simulated directory listing failure"); });
  syncBuiltinESMExports();
  let result: ReturnType<typeof writePolicyFile>;
  try { result = writePolicyFile(file, expected, next); }
  finally { mock.mock.restore(); syncBuiltinESMExports(); }
  assert.match(result.backupCleanupWarning!, /Policy applied.*cleanup was incomplete/);
  assert.equal(await readFile(result.backup!, "utf8"), before);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), next);
  assert(!(await readdir(dir)).some(name => name.endsWith(".tmp") || name.endsWith(".lock")));
});
