import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const moduleURL = new URL("../scripts/runtime.mjs", import.meta.url);
const { supportedVersion, selectRuntime } = await import(moduleURL.href);
const portableAvailable = process.platform === "win32" && process.arch === "x64" &&
  existsSync(fileURLToPath(new URL("../.faultline/runtime/node.exe", import.meta.url)));

test("runtime policy rejects older, unsupported and prerelease Node versions", () => {
  for (const version of ["22.13.0", "22.21.1", "22.23.3", "20.20.0", "23.0.0", "24.0.0", "22.23.4-rc.1", "garbage"])
    assert.equal(supportedVersion(version), false, version);
  for (const version of ["22.23.4", "v22.23.4", "22.23.5", "22.24.0"])
    assert.equal(supportedVersion(version), true, version);
  assert.equal(selectRuntime("22.23.4"), process.execPath);
});

test("an older runtime fails closed with setup guidance when portable Node is absent", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "faultline-runtime-"));
  try {
    const scripts = path.join(root, "scripts");
    await mkdir(scripts);
    const copy = path.join(scripts, "runtime.mjs");
    await copyFile(fileURLToPath(moduleURL), copy);
    const isolated = await import(pathToFileURL(copy).href);
    assert.throws(() => isolated.selectRuntime("22.21.1"),
      process.platform === "win32" && process.arch === "x64"
        ? /pwsh -NoProfile -File scripts\/setup-runtime\.ps1/
        : /Windows x64 only/);
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("faultline-runtime-"));
    await rm(root, { recursive: true, force: true });
  }
});

test("installed portable Node is version-checked before selection", {
  skip: !portableAvailable,
}, () => {
  assert.equal(selectRuntime("22.21.1"), fileURLToPath(new URL("../.faultline/runtime/node.exe", import.meta.url)));
});

test("launcher runs a supported Node and preserves the child exit code", {
  skip: !supportedVersion(process.versions.node) && !portableAvailable,
}, () => {
  const result = spawnSync(process.execPath, [fileURLToPath(moduleURL), "-e", "console.log(process.version); process.exit(7)"], {
    encoding: "utf8", timeout: 10_000, windowsHide: true,
  });
  assert.equal(result.status, 7, result.stderr);
  assert.equal(supportedVersion(result.stdout.trim()), true);
});
