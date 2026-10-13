import { createHash, randomUUID } from "node:crypto";
import { closeSync, fsyncSync, linkSync, lstatSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { parsePolicy, RoutingError } from "./core/index.ts";
import type { Policy } from "./core/index.ts";

const MAX_BYTES = 262_144;
export interface PolicyFile { readonly bytes: Buffer | null; readonly fingerprint: string; readonly policy?: Policy }
const fingerprint = (bytes: Buffer | null) => bytes === null ? "missing" : createHash("sha256").update(bytes).digest("hex");
/** Bounded, no-follow final-path read. Parent directories are operator-controlled. */
export function readPolicyFile(file: string): PolicyFile {
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new RoutingError("INVALID_CONFIG", "Advisor requires a regular, non-symlink policy file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { bytes: null, fingerprint: "missing" };
    throw error;
  }
  const fd = openSync(file, "r");
  let bytes: Buffer;
  try {
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const size = readSync(fd, buffer, total, buffer.length - total, null);
      if (!size) break;
      total += size;
    }
    if (total > MAX_BYTES) throw new RoutingError("INVALID_CONFIG", "Policy file exceeds 256 KiB");
    bytes = buffer.subarray(0, total);
  } finally { closeSync(fd); }
  let input: unknown;
  try { input = JSON.parse(bytes.toString("utf8")); }
  catch { throw new RoutingError("INVALID_CONFIG", "Policy file contains invalid JSON"); }
  return { bytes, fingerprint: fingerprint(bytes), policy: parsePolicy(input) };
}
/** Cooperative exclusive lock, byte-level stale check, backup and same-directory atomic replacement.
 * Not a security boundary against hostile local processes or non-cooperating writers. */
export function writePolicyFile(file: string, expected: string, config: unknown): { backup: string | null } {
  const policy = parsePolicy(config);
  const text = JSON.stringify(policy.config, null, 2) + "\n";
  if (Buffer.byteLength(text) > MAX_BYTES) throw new RoutingError("INVALID_CONFIG", "Formatted policy exceeds 256 KiB");
  const lock = `${file}.advisor.lock`;
  let lockFd: number;
  try { lockFd = openSync(lock, "wx", 0o600); }
  catch { throw new RoutingError("STALE_DECISION", "Policy directory unavailable or advisor lock exists; inspect it before retrying"); }
  const temp = `${file}.advisor-${randomUUID()}.tmp`;
  let createdTemp = false;
  try {
    const current = readPolicyFile(file);
    if (current.fingerprint !== expected) throw new RoutingError("STALE_DECISION", "Policy changed since proposal; inspect and propose again");
    const fd = openSync(temp, "wx", 0o600);
    createdTemp = true;
    try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
    const backup = current.bytes === null ? null : `${file}.advisor-${randomUUID()}.bak`;
    if (backup) writeFileSync(backup, current.bytes!, { flag: "wx", mode: 0o600 });
    if (readPolicyFile(file).fingerprint !== expected) throw new RoutingError("STALE_DECISION", "Policy changed during apply; inspect and propose again");
    if (current.bytes === null) linkSync(temp, file); // Exclusive create: never overwrite a newly appeared file.
    else { renameSync(temp, file); createdTemp = false; }
    return { backup };
  } finally {
    try { if (createdTemp) unlinkSync(temp); }
    finally { closeSync(lockFd); unlinkSync(lock); }
  }
}
