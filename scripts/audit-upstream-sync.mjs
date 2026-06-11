import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const upstreamRef = process.env.INKOS_UPSTREAM_REF || "refs/tags/v1.5.0";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function listTree(ref) {
  const output = git(["ls-tree", "-r", "--name-only", ref]);
  return new Set(output ? output.split(/\r?\n/) : []);
}

function refHash(ref, path) {
  try {
    return git(["rev-parse", `${ref}:${path}`]);
  } catch {
    return "";
  }
}

function listWorktree() {
  const output = git(["ls-files", "--cached", "--others", "--exclude-standard"]);
  return new Set((output ? output.split(/\r?\n/) : []).filter((path) => existsSync(path)));
}

function worktreeHash(path) {
  try {
    return git(["hash-object", "--", path]);
  } catch {
    return "";
  }
}

function classify(path) {
  if (path.startsWith("packages/studio/android/") || path === "packages/studio/capacitor.config.ts") {
    return "android-only";
  }
  if (path.startsWith("packages/core/")) return "core";
  if (path.startsWith("packages/cli/")) return "cli";
  if (path.startsWith("packages/studio/")) return "studio";
  return "workspace";
}

const committedOnly = process.argv.includes("--committed");
const local = committedOnly ? listTree("HEAD") : listWorktree();
const upstream = listTree(upstreamRef);
const paths = [...new Set([...local, ...upstream])].sort();
const report = {
  upstreamRef,
  upstreamCommit: git(["rev-parse", upstreamRef]),
  localSource: committedOnly ? "HEAD" : "worktree",
  generatedAt: new Date().toISOString(),
  upstreamOnly: [],
  localOnly: [],
  diverged: [],
  matching: 0,
};

for (const path of paths) {
  const inLocal = local.has(path);
  const inUpstream = upstream.has(path);
  if (!inLocal) {
    report.upstreamOnly.push({ path, area: classify(path) });
  } else if (!inUpstream) {
    report.localOnly.push({ path, area: classify(path) });
  } else if ((committedOnly ? refHash("HEAD", path) : worktreeHash(path)) !== refHash(upstreamRef, path)) {
    report.diverged.push({ path, area: classify(path) });
  } else {
    report.matching += 1;
  }
}

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  console.log(`Upstream: ${report.upstreamRef} (${report.upstreamCommit.slice(0, 12)})`);
  console.log(`Local source: ${report.localSource}`);
  console.log(`Matching: ${report.matching}`);
  console.log(`Upstream only: ${report.upstreamOnly.length}`);
  console.log(`Local only: ${report.localOnly.length}`);
  console.log(`Diverged: ${report.diverged.length}`);
  for (const [label, entries] of [
    ["UPSTREAM_ONLY", report.upstreamOnly],
    ["LOCAL_ONLY", report.localOnly],
    ["DIVERGED", report.diverged],
  ]) {
    if (entries.length === 0) continue;
    console.log(`\n${label}`);
    for (const entry of entries) console.log(`${entry.area}\t${entry.path}`);
  }
}
