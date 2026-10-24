import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  readFile,
  rename,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { analyzeRepository } from "../packages/analyzer/src/index.ts";

const execute = promisify(execFile);
async function fixture(files: Record<string, string>) {
  const repository = await mkdtemp(
    path.join(os.tmpdir(), "faultline-analysis-"),
  );
  const git = async (...args: string[]) =>
    (
      await execute("git", ["-C", repository, ...args], { windowsHide: true })
    ).stdout.trim();
  const put = async (file: string, text: string) => {
    await mkdir(path.dirname(path.join(repository, file)), { recursive: true });
    await writeFile(path.join(repository, file), text);
  };
  await git("init", "--quiet");
  await git("config", "user.email", "fixture@example.invalid");
  await git("config", "user.name", "Faultline Test");
  await git("config", "core.autocrlf", "false");
  for (const [file, text] of Object.entries(files)) await put(file, text);
  await git("add", ".");
  await git("commit", "-qm", "base");
  const baseRef = await git("rev-parse", "HEAD");
  const cleanup = async () => {
    const temporaryRoot = path.resolve(os.tmpdir());
    const target = path.resolve(repository);
    assert.equal(path.dirname(target), temporaryRoot);
    assert.ok(path.basename(target).startsWith("faultline-analysis-"));
    await rm(target, { recursive: true, force: true });
  };
  return {
    repository,
    git,
    put,
    baseRef,
    cleanup,
    commit: async () => {
      await git("add", "-A");
      await git("commit", "-qm", "candidate");
      return await git("rev-parse", "HEAD");
    },
  };
}

test("tracks transitive AST imports, changed symbols and precise changed line totals", async () => {
  const f = await fixture({
    "src/payment.ts": "export function charge() {\n  return 1;\n}\n",
    "src/checkout.ts":
      "import { charge } from './payment.js';\nexport function checkout() { return charge(); }\n",
    "src/api.mjs": "export { checkout } from './checkout.js';\n",
    "src/unrelated.ts": "export const other = 1;\n",
    "node_modules/ignored.ts": "export const ignored = 1;\n",
    "secrets.ts": 'export const secret = "must-not-leak";\n',
  });
  try {
    await f.put(
      "src/payment.ts",
      "export function charge() {\n  return 2;\n}\n",
    );
    const headRef = await f.commit();
    const result = await analyzeRepository({
      repository: f.repository,
      baseRef: f.baseRef,
      headRef,
    });
    assert.equal(result.summary.filesChanged, 1);
    assert.equal(result.summary.impactedFiles, 2);
    assert.equal(result.summary.totalFiles, 4);
    assert.equal(result.changes[0].additions, 1);
    assert.equal(result.changes[0].deletions, 1);
    assert.ok(
      result.changes[0].symbols.some((symbol) => symbol.name === "charge"),
    );
    assert.deepEqual(
      result.impacts.find((impact) => impact.path === "src/api.mjs")?.chain,
      ["src/payment.ts", "src/checkout.ts", "src/api.mjs"],
    );
    assert.equal(
      result.graph.nodes.find((node) => node.path === "src/unrelated.ts")
        ?.status,
      "unaffected",
    );
    assert.equal(result.experimentEligible, false);
    assert.ok(result.recommendations.includes("connection-reset"));
    assert.ok(!JSON.stringify(result).includes("must-not-leak"));
    assert.ok(result.warnings.some((warning) => warning.includes("not proof")));
  } finally {
    await f.cleanup();
  }
});

test("retains deleted dependencies and reports a deleted symbol", async () => {
  const f = await fixture({
    "dependency.ts": "export function gone() { return true; }\n",
    "consumer.ts":
      "import { gone } from './dependency';\nexport const use = gone;\n",
  });
  try {
    await rm(path.join(f.repository, "dependency.ts"));
    const result = await analyzeRepository({
      repository: f.repository,
      baseRef: f.baseRef,
      headRef: await f.commit(),
    });
    assert.equal(result.changes[0].status, "deleted");
    assert.ok(
      result.changes[0].symbols.some((symbol) => symbol.name === "gone"),
    );
    assert.equal(result.impacts[0].path, "consumer.ts");
    assert.deepEqual(result.impacts[0].chain, ["dependency.ts", "consumer.ts"]);
  } finally {
    await f.cleanup();
  }
});

test("recognizes exact renames and preserves their former dependents", async () => {
  const f = await fixture({
    "old.ts": "export const value = 1;\n",
    "consumer.ts": "export { value } from './old';\n",
  });
  try {
    await rename(
      path.join(f.repository, "old.ts"),
      path.join(f.repository, "new.ts"),
    );
    const result = await analyzeRepository({
      repository: f.repository,
      baseRef: f.baseRef,
      headRef: await f.commit(),
    });
    assert.equal(result.changes[0].status, "renamed");
    assert.equal(result.changes[0].path, "new.ts");
    assert.equal(result.changes[0].additions, 0);
    assert.equal(result.changes[0].deletions, 0);
    assert.equal(result.impacts[0].path, "consumer.ts");
  } finally {
    await f.cleanup();
  }
});

test("WORKTREE includes tracked edits and staged additions, excludes untracked files, and leaves the repo unchanged", async () => {
  const f = await fixture({
    "index.ts": "export const first = 1;\n",
    "delete.ts": "export const removed = 1;\n",
  });
  try {
    await f.put("index.ts", "export { added } from './new.js';\n");
    await f.put("new.ts", "export const added = 2;\n");
    await f.git("add", "new.ts");
    await f.put("untracked.ts", "export const doNotRead = 99;\n");
    await rm(path.join(f.repository, "delete.ts"));
    const statusBefore = await f.git("status", "--porcelain");
    const indexBefore = await f.git("ls-files", "--stage");
    const result = await analyzeRepository({
      repository: f.repository,
      baseRef: f.baseRef,
      headRef: "WORKTREE",
    });
    assert.equal(result.summary.filesChanged, 3);
    assert.ok(
      result.changes.some(
        (change) => change.path === "new.ts" && change.status === "added",
      ),
    );
    assert.ok(
      result.changes.some(
        (change) => change.path === "delete.ts" && change.status === "deleted",
      ),
    );
    assert.ok(!result.graph.nodes.some((node) => node.path === "untracked.ts"));
    assert.equal(result.headCommit, f.baseRef);
    assert.equal(await f.git("status", "--porcelain"), statusBefore);
    assert.equal(await f.git("ls-files", "--stage"), indexBefore);
    assert.equal(
      await readFile(path.join(f.repository, "index.ts"), "utf8"),
      "export { added } from './new.js';\n",
    );
  } finally {
    await f.cleanup();
  }
});

test("rejects unsafe refs, relative paths, missing refs and repository subdirectories", async () => {
  const f = await fixture({ "src/index.ts": "export const a = 1;\n" });
  try {
    for (const headRef of [
      "--help",
      "HEAD;whoami",
      "HEAD\nHEAD",
      "HEAD:src/index.ts",
      "HEAD..HEAD",
    ])
      await assert.rejects(
        analyzeRepository({
          repository: f.repository,
          baseRef: f.baseRef,
          headRef,
        }),
      );
    await assert.rejects(
      analyzeRepository({
        repository: ".",
        baseRef: f.baseRef,
        headRef: "HEAD",
      }),
      /absolute/,
    );
    await assert.rejects(
      analyzeRepository({
        repository: f.repository,
        baseRef: f.baseRef,
        headRef: "does-not-exist",
      }),
      /Git operation failed/,
    );
    await assert.rejects(
      analyzeRepository({
        repository: path.join(f.repository, "src"),
        baseRef: f.baseRef,
        headRef: "HEAD",
      }),
      /root directory/,
    );
  } finally {
    await f.cleanup();
  }
});

test("identical commits produce no changed symbols, impacts, or failure suggestions", async () => {
  const f = await fixture({
    "payment.ts": "export function retry() { return true; }\n",
  });
  try {
    const result = await analyzeRepository({
      repository: f.repository,
      baseRef: f.baseRef,
      headRef: f.baseRef,
    });
    assert.deepEqual(result.summary, {
      filesChanged: 0,
      symbolsChanged: 0,
      impactedFiles: 0,
      totalFiles: 1,
    });
    assert.deepEqual(result.recommendations, ["healthy"]);
    assert.deepEqual(result.changes, []);
    assert.deepEqual(result.impacts, []);
  } finally {
    await f.cleanup();
  }
});

test("oversized candidate sources omit their patches instead of reading unbounded content", async () => {
  const f = await fixture({ "large.ts": "export const before = 1;\n" });
  try {
    await f.put(
      "large.ts",
      `export const payload = '${"x".repeat(600 * 1024)}';\n`,
    );
    const result = await analyzeRepository({
      repository: f.repository,
      baseRef: f.baseRef,
      headRef: await f.commit(),
    });
    assert.equal(result.changes[0].status, "modified");
    assert.ok(result.changes[0].patch.startsWith("[Patch omitted:"));
    assert.ok(
      result.warnings.some((warning) =>
        warning.includes("coverage is incomplete"),
      ),
    );
    assert.ok(JSON.stringify(result).length < 20_000);
  } finally {
    await f.cleanup();
  }
});

test("WORKTREE ignores files removed from the index and historical symlink entries", async () => {
  const f = await fixture({
    "retired.ts": "export const retired = 1;\n",
    "index.ts": "export const active = 1;\n",
  });
  try {
    await f.git("rm", "--cached", "retired.ts");
    await f.put("link-target.txt", "../outside.ts");
    const blob = await f.git("hash-object", "-w", "link-target.txt");
    await f.git(
      "update-index",
      "--add",
      "--cacheinfo",
      `120000,${blob},linked.ts`,
    );
    await f.put("linked.ts", "export const mustNotBeParsed = 1;\n");
    const result = await analyzeRepository({
      repository: f.repository,
      baseRef: f.baseRef,
      headRef: "WORKTREE",
    });
    assert.ok(!result.graph.nodes.some((node) => node.path === "linked.ts"));
    assert.ok(!JSON.stringify(result).includes("mustNotBeParsed"));
    assert.equal(
      result.changes.find((change) => change.path === "retired.ts")?.status,
      "deleted",
    );
    assert.ok(result.graph.nodes.some((node) => node.path === "retired.ts"));
  } finally {
    await f.cleanup();
  }
});

test("WORKTREE disables configured clean filters instead of executing repository commands", async () => {
  const f = await fixture({
    "index.ts": "export const value = 1;\n",
    ".gitattributes": "*.ts filter=blocked\n",
  });
  try {
    await f.git(
      "config",
      "filter.blocked.clean",
      "faultline-this-command-must-never-execute",
    );
    await f.git("config", "filter.blocked.required", "true");
    await f.put("index.ts", "export const value = 2;\n");
    const result = await analyzeRepository({
      repository: f.repository,
      baseRef: f.baseRef,
      headRef: "WORKTREE",
    });
    assert.equal(result.summary.filesChanged, 1);
    assert.equal(result.changes[0].additions, 1);
    assert.ok(
      result.warnings.some((warning) =>
        warning.includes("filter commands cannot execute"),
      ),
    );
  } finally {
    await f.cleanup();
  }
});
