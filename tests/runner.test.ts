import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureDemo } from "../packages/runner/src/demo.ts";
import { runExperiment } from "../packages/runner/src/index.ts";
import { git } from "../packages/runner/src/fixture.ts";
import type { DemoProject } from "../packages/shared/src/index.ts";

let root: string;
let demo: DemoProject;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "faultline-runner-"));
  demo = await ensureDemo(root);
});
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith("faultline-runner-"));
  await rm(root, { recursive: true, force: true });
});

const execute = (
  scenario: "healthy" | "connection-reset" | "latency" | "dependency-down",
) =>
  runExperiment({
    fixtureRepository: demo.repository,
    workDir: join(root, "work", scenario),
    scenario,
    requests: 5,
  });

test("demo creation is idempotent and preserves existing user work", async () => {
  const note = join(demo.repository, "notes.txt");
  await writeFile(note, "Keep this user file");
  assert.deepEqual(await ensureDemo(root), demo);
  assert.equal(await readFile(note, "utf8"), "Keep this user file");
});

test("healthy control runs real services without duplicate charges", async () => {
  const result = await execute("healthy");
  assert.equal(result.verdict, "no-regression");
  for (const variant of [result.baseline, result.candidate]) {
    assert.equal(variant.successes, 5);
    assert.equal(variant.totalCharges, 5);
    assert.equal(variant.duplicateCharges, 0);
    assert.equal(variant.inventoryReservations, 5);
    assert.ok(variant.p95Ms > 0);
    assert.deepEqual(
      new Set(variant.traces.map((trace) => trace.service)),
      new Set(["checkout", "inventory", "payments"]),
    );
    assert.ok(
      variant.traces.every(
        (trace) => Number.isFinite(trace.durationMs) && trace.durationMs >= 0,
      ),
    );
  }
  assert.equal(result.environment.kind, "local-process");
  assert.deepEqual(await readdir(join(root, "work", "healthy")), []);
});

test("lost acknowledgement preserves baseline idempotency and exposes candidate duplicate charges", async () => {
  const result = await execute("connection-reset");
  assert.equal(result.verdict, "regression");
  assert.equal(result.baseline.successes, 5);
  assert.equal(result.candidate.successes, 5);
  assert.equal(result.baseline.totalCharges, 5);
  assert.equal(result.candidate.totalCharges, 10);
  assert.equal(result.baseline.duplicateCharges, 0);
  assert.equal(result.candidate.duplicateCharges, 5);
  assert.ok(
    result.candidate.traces.some((trace) =>
      trace.detail.includes("socket destroyed"),
    ),
  );
  assert.deepEqual(
    new Set(result.baseline.traces.map((trace) => trace.requestId)),
    new Set(result.candidate.traces.map((trace) => trace.requestId)),
  );
});

test("measured dependency timeout causes a retry and reveals the same correctness regression", async () => {
  const result = await execute("latency");
  assert.equal(result.verdict, "regression");
  assert.equal(result.baseline.duplicateCharges, 0);
  assert.equal(result.candidate.duplicateCharges, 5);
  assert.ok(result.baseline.p50Ms >= 170);
  assert.ok(
    result.candidate.traces.some((trace) => trace.detail.includes("timed out")),
  );
});

test("outage commits no payments and releases inventory in both variants", async () => {
  const result = await execute("dependency-down");
  assert.equal(result.verdict, "inconclusive");
  for (const variant of [result.baseline, result.candidate]) {
    assert.equal(variant.successes, 0);
    assert.equal(variant.failures, 5);
    assert.equal(variant.totalCharges, 0);
    assert.equal(variant.inventoryReservations, 0);
    assert.ok(variant.traces.some((trace) => trace.operation === "release"));
  }
});

test("cancellation stops child services and removes only disposable snapshots", async () => {
  const controller = new AbortController();
  const workDir = join(root, "work", "cancelled");
  await assert.rejects(
    runExperiment({
      fixtureRepository: demo.repository,
      workDir,
      scenario: "latency",
      requests: 100,
      signal: controller.signal,
      onEvent: (event) => {
        if (event.phase === "baseline" && event.message.startsWith("Sending"))
          setTimeout(() => controller.abort(), 40);
      },
    }),
    { name: "AbortError" },
  );
  assert.deepEqual(await readdir(workDir), []);
  assert.equal(
    await readFile(join(demo.repository, "notes.txt"), "utf8"),
    "Keep this user file",
  );
});

test("maximum 100-request latency workload completes and removes both snapshots", async () => {
  const workDir = join(root, "work", "maximum");
  const start = performance.now();
  const result = await runExperiment({
    fixtureRepository: demo.repository,
    workDir,
    scenario: "latency",
    requests: 100,
  });
  assert.equal(result.baseline.successes, 100);
  assert.equal(result.candidate.successes, 100);
  assert.equal(result.baseline.totalCharges, 100);
  assert.equal(result.candidate.totalCharges, 200);
  assert.equal(result.candidate.duplicateCharges, 100);
  assert.ok(
    performance.now() - start < 25_000,
    "Bounded local workload should finish within 25 seconds",
  );
  assert.deepEqual(await readdir(workDir), []);
});

test("fixture service exits when its coordinator crashes and the IPC pipe closes", async () => {
  const service = fileURLToPath(
    new URL(
      "../packages/runner/fixture/src/services/inventory.mjs",
      import.meta.url,
    ),
  );
  const coordinator = spawn(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
    import { fork } from 'node:child_process';
    const child = fork(process.env.FAULTLINE_TEST_SERVICE, [], { execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    child.on('message', (message) => process.send({ ...message, pid: child.pid }));
  `,
    ],
    {
      env: { ...process.env, FAULTLINE_TEST_SERVICE: service },
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  let servicePid = 0;
  const exists = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  try {
    const startup = await new Promise<{ pid: number; port: number }>(
      (ready, fail) => {
        const timer = setTimeout(
          () => fail(new Error("Orphan test coordinator failed to start")),
          5000,
        );
        coordinator.once("error", fail);
        coordinator.once("message", (value) => {
          clearTimeout(timer);
          ready(value as { pid: number; port: number });
        });
      },
    );
    servicePid = startup.pid;
    assert.equal(
      (await fetch(`http://127.0.0.1:${startup.port}/_state`)).status,
      200,
    );
    const exited = new Promise<void>((done) =>
      coordinator.once("exit", () => done()),
    );
    coordinator.kill("SIGKILL");
    await exited;
    const deadline = performance.now() + 3000;
    while (exists(servicePid) && performance.now() < deadline)
      await new Promise((done) => setTimeout(done, 30));
    assert.equal(
      exists(servicePid),
      false,
      "Owned service must exit when coordinator disappears",
    );
  } finally {
    coordinator.kill("SIGKILL");
    if (servicePid && exists(servicePid)) process.kill(servicePid, "SIGKILL");
  }
});

test("invalid workload and a substituted snapshot are refused before execution", async () => {
  await assert.rejects(
    runExperiment({
      fixtureRepository: demo.repository,
      workDir: join(root, "invalid"),
      scenario: "healthy",
      requests: 4,
    }),
    /5 to 100/,
  );
  const wrongCommit = (
    await git(demo.repository, ["rev-parse", "baseline"])
  ).trim();
  await assert.rejects(
    runExperiment({
      fixtureRepository: demo.repository,
      workDir: join(root, "invalid"),
      scenario: "healthy",
      requests: 5,
      candidateCommit: wrongCommit,
    }),
    /fixture mismatch/,
  );
});
