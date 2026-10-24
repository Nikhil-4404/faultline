import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
export const FIXTURE_FILES = [
  "package.json",
  "fixture.json",
  "src/common/http.mjs",
  "src/clients/inventory.mjs",
  "src/clients/payments.mjs",
  "src/services/checkout.mjs",
  "src/services/inventory.mjs",
  "src/services/payments.mjs",
];

export async function git(repository: string, args: string[]): Promise<string> {
  const result = await execute(
    "git",
    [
      "-c",
      "core.autocrlf=false",
      "-c",
      "core.quotePath=false",
      "-C",
      repository,
      ...args,
    ],
    {
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  return result.stdout;
}

export async function fixtureSources(
  variant: "baseline" | "candidate",
): Promise<Map<string, string>> {
  const entries = await Promise.all(
    FIXTURE_FILES.map(
      async (path) =>
        [
          path,
          await readFile(
            fileURLToPath(new URL(`../fixture/${path}`, import.meta.url)),
            "utf8",
          ),
        ] as const,
    ),
  );
  const files = new Map<string, string>(entries);
  if (variant === "candidate") {
    const source = files.get("src/clients/payments.mjs")!;
    files.set(
      "src/clients/payments.mjs",
      source.replace("return orderId;", "return `${orderId}-${attempt}`;"),
    );
  }
  return files;
}

export async function verifiedSnapshot(
  repository: string,
  ref: string,
  variant: "baseline" | "candidate",
) {
  if (!/^(baseline|candidate|[a-f0-9]{40}|[a-f0-9]{64})$/.test(ref))
    throw new Error("Invalid controlled fixture revision");
  const root = (await git(repository, ["rev-parse", "--show-toplevel"])).trim();
  if (
    (await realpath(root)).toLowerCase() !==
    (await realpath(resolve(repository))).toLowerCase()
  ) {
    throw new Error("Fixture path must be the repository root");
  }
  const commit = (
    await git(repository, ["rev-parse", "--verify", `${ref}^{commit}`])
  ).trim();
  const paths = (
    await git(repository, ["ls-tree", "-r", "--name-only", commit])
  )
    .trim()
    .split("\n")
    .sort();
  if (paths.join("\n") !== [...FIXTURE_FILES].sort().join("\n"))
    throw new Error("Only the unmodified bundled fixture can execute");
  const expected = await fixtureSources(variant);
  const files = new Map<string, string>();
  for (const path of FIXTURE_FILES) {
    const source = await git(repository, ["show", `${commit}:${path}`]);
    if (source !== expected.get(path))
      throw new Error(
        `Controlled ${variant} fixture mismatch: ${path}. Existing files were preserved.`,
      );
    files.set(path, source);
  }
  return { commit, files };
}
