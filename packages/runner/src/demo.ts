import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { DemoProject } from "../../shared/src/index.ts";
import { fixtureSources, git, verifiedSnapshot } from "./fixture.ts";

export async function ensureDemo(projectRoot: string): Promise<DemoProject> {
  const repository = join(resolve(projectRoot), ".faultline", "demo-v2");
  await mkdir(dirname(repository), { recursive: true });
  let created = false;
  try {
    await mkdir(repository);
    created = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  if (created) {
    await git(repository, ["init", "--quiet"]);
    await git(repository, ["config", "core.autocrlf", "false"]);
    await git(repository, [
      "config",
      "core.hooksPath",
      join(repository, ".git", "disabled-hooks"),
    ]);
    for (const variant of ["baseline", "candidate"] as const) {
      for (const [path, source] of await fixtureSources(variant)) {
        await mkdir(dirname(join(repository, path)), { recursive: true });
        await writeFile(join(repository, path), source, "utf8");
      }
      await git(repository, ["add", "--", "."]);
      await git(repository, [
        "-c",
        "user.name=Faultline Reference",
        "-c",
        "user.email=reference@faultline.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--quiet",
        "-m",
        variant === "baseline"
          ? "Stable order identity preserves retry idempotency"
          : "Regression: payment key changes on retry",
      ]);
      await git(repository, ["tag", variant]);
    }
  }
  // Existing repositories are validated, never repaired with destructive resets.
  await verifiedSnapshot(repository, "baseline", "baseline");
  await verifiedSnapshot(repository, "candidate", "candidate");
  return {
    repository,
    name: "Checkout reliability lab",
    baseRef: "baseline",
    headRef: "candidate",
    description:
      "Three real local HTTP services; a one-line retry regression can duplicate a test charge after a lost acknowledgement.",
  };
}
