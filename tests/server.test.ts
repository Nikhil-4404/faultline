import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  readdir,
  mkdir,
  writeFile,
  readFile,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { request } from "node:http";
import { createApp } from "../apps/server/src/app.ts";
import { RecordStore } from "../apps/server/src/store.ts";
import { ensureDemo } from "../packages/runner/src/demo.ts";
import type {
  AnalysisResult,
  ExperimentRun,
  Health,
} from "../packages/shared/src/index.ts";

async function removeTestDirectory(directory: string) {
  const absolute = resolve(directory);
  assert.ok(
    absolute.startsWith(resolve(tmpdir()) + sep) &&
      /^faultline-(store|api)-/.test(absolute.split(sep).at(-1)!),
    "cleanup stays inside an owned temporary test directory",
  );
  await rm(absolute, { recursive: true, force: true });
}

test("record persistence serializes updates, survives reload and rejects unsafe identities", async () => {
  const directory = await mkdtemp(join(tmpdir(), "faultline-store-"));
  try {
    const store = new RecordStore<{ id: string; count: number }>(directory);
    await store.load();
    const id = "00000000-0000-0000-0000-000000000001";
    await Promise.all(
      Array.from({ length: 15 }, (_, count) => store.put({ id, count })),
    );
    assert.equal(store.get(id)?.count, 14);
    const reloaded = new RecordStore<{ id: string; count: number }>(directory);
    await reloaded.load();
    assert.equal(reloaded.get(id)?.count, 14);
    assert.equal(
      (await readdir(directory)).filter((file) => file.endsWith(".json"))
        .length,
      1,
    );
    await assert.rejects(store.put({ id: "../escape", count: 0 }), /identity/);
  } finally {
    await removeTestDirectory(directory);
  }
});

test(
  "real HTTP API validates boundaries, saves evidence, cancels and recovers interrupted runs",
  { timeout: 60_000 },
  async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "faultline-api-"));
    const dataDir = join(projectRoot, ".faultline");
    let app: Awaited<ReturnType<typeof createApp>> | undefined;
    try {
      const demo = await ensureDemo(projectRoot);
      app = await createApp({ projectRoot, dataDir, demo });
      await new Promise<void>((done) =>
        app!.server.listen(0, "127.0.0.1", done),
      );
      const address = app.server.address();
      assert.ok(address && typeof address === "object");
      let url = `http://127.0.0.1:${address.port}`;
      const get = (route: string) => fetch(url + route);
      const post = (
        route: string,
        body: unknown,
        headers: Record<string, string> = {},
      ) =>
        fetch(url + route, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
        });
      assert.equal((await get("/api/health")).status, 200);
      assert.equal(
        (
          await post(
            "/api/analyses",
            {},
            { origin: "https://untrusted.example" },
          )
        ).status,
        403,
      );
      assert.equal((await post("/api/analyses", {})).status, 400);
      assert.equal(
        (await post("/api/analyses", { repository: "x".repeat(17_000) }))
          .status,
        413,
      );
      const analyzed = await post("/api/analyses", {
        repository: demo.repository,
        baseRef: demo.baseRef,
        headRef: demo.headRef,
      });
      assert.equal(analyzed.status, 201);
      const analysis = (await analyzed.json()) as AnalysisResult;
      assert.equal(analysis.experimentEligible, true);
      assert.ok(analysis.summary.filesChanged >= 1);
      const readOnly = (await (
        await post("/api/analyses", {
          repository: demo.repository,
          baseRef: demo.baseRef,
          headRef: demo.baseRef,
        })
      ).json()) as AnalysisResult;
      assert.equal(readOnly.experimentEligible, false);
      assert.equal(
        (
          await post("/api/runs", {
            analysisId: readOnly.id,
            scenario: "healthy",
            requests: 5,
          })
        ).status,
        422,
      );
      assert.equal(
        (
          await post("/api/runs", {
            analysisId: analysis.id,
            scenario: "unknown",
            requests: 5,
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await post("/api/runs", {
            analysisId: analysis.id,
            scenario: "healthy",
            requests: 101,
          })
        ).status,
        400,
      );
      const response = await post("/api/runs", {
        analysisId: analysis.id,
        scenario: "connection-reset",
        requests: 5,
      });
      assert.equal(response.status, 202);
      let run = (await response.json()) as ExperimentRun;
      assert.equal(
        (
          await post("/api/runs", {
            analysisId: analysis.id,
            scenario: "healthy",
            requests: 5,
          })
        ).status,
        409,
      );
      const deadline = Date.now() + 20_000;
      while (run.status === "queued" || run.status === "running") {
        assert.ok(
          Date.now() < deadline,
          "experiment completed within 20 seconds",
        );
        await new Promise((done) => setTimeout(done, 100));
        run = (await (
          await get(`/api/runs/${run.id}`)
        ).json()) as ExperimentRun;
      }
      assert.equal(run.status, "completed", run.error);
      assert.equal(run.result?.verdict, "regression");
      assert.equal(run.result?.baseline.duplicateCharges, 0);
      assert.ok((run.result?.candidate.duplicateCharges ?? 0) > 0);
      const exported = await (await get(`/api/runs/${run.id}/export`)).json();
      assert.equal(exported.schemaVersion, 1);
      assert.equal(exported.analysis.id, analysis.id);
      assert.equal(exported.run.id, run.id);
      const cancelResponse = await post("/api/runs", {
        analysisId: analysis.id,
        scenario: "latency",
        requests: 100,
      });
      let cancel = (await cancelResponse.json()) as ExperimentRun;
      assert.equal(
        (await post(`/api/runs/${cancel.id}/cancel`, {})).status,
        200,
      );
      const cancelDeadline = Date.now() + 10_000;
      while (cancel.status === "queued" || cancel.status === "running") {
        assert.ok(Date.now() < cancelDeadline);
        await new Promise((done) => setTimeout(done, 80));
        cancel = (await (
          await get(`/api/runs/${cancel.id}`)
        ).json()) as ExperimentRun;
      }
      assert.equal(cancel.status, "cancelled");
      assert.equal(cancel.result, undefined);
      await app.shutdown();
      app = undefined;
      const runStore = new RecordStore<ExperimentRun>(join(dataDir, "runs"));
      await runStore.load();
      const interrupted: ExperimentRun = {
        id: "00000000-0000-0000-0000-000000000002",
        analysisId: analysis.id,
        scenario: "healthy",
        requests: 5,
        status: "running",
        createdAt: new Date().toISOString(),
        events: [],
      };
      await runStore.put(interrupted);
      const analysisStore = new RecordStore<AnalysisResult>(
        join(dataDir, "analyses"),
      );
      await analysisStore.load();
      const previousAnalysis: AnalysisResult = {
        ...analysis,
        id: "00000000-0000-0000-0000-000000000003",
        repository: join(projectRoot, ".faultline", "previous-demo"),
        experimentEligible: true,
      };
      await analysisStore.put(previousAnalysis);
      const previousRun: ExperimentRun = {
        ...run,
        id: "00000000-0000-0000-0000-000000000004",
        analysisId: previousAnalysis.id,
      };
      await runStore.put(previousRun);
      const previousPath = join(
        dataDir,
        "analyses",
        previousAnalysis.id + ".json",
      );
      const previousBytes = await readFile(previousPath, "utf8");
      app = await createApp({ projectRoot, dataDir, demo });
      await new Promise<void>((done) =>
        app!.server.listen(0, "127.0.0.1", done),
      );
      const restartedAddress = app.server.address();
      assert.ok(restartedAddress && typeof restartedAddress === "object");
      url = `http://127.0.0.1:${restartedAddress.port}`;
      const listed = (await (
        await get("/api/analyses")
      ).json()) as AnalysisResult[];
      assert.equal(
        listed.find((item) => item.id === previousAnalysis.id)
          ?.experimentEligible,
        false,
      );
      assert.equal(
        listed.find((item) => item.id === analysis.id)?.experimentEligible,
        true,
      );
      const staleResponse = await post("/api/runs", {
        analysisId: previousAnalysis.id,
        scenario: "healthy",
        requests: 5,
      });
      assert.equal(staleResponse.status, 422);
      assert.match((await staleResponse.json()).error, /Reanalyze/);
      const historical = await (
        await get(`/api/runs/${previousRun.id}/export`)
      ).json();
      assert.deepEqual(historical.analysis, previousAnalysis);
      assert.deepEqual(historical.run, previousRun);
      assert.equal(await readFile(previousPath, "utf8"), previousBytes);
      const saved = new RecordStore<ExperimentRun>(join(dataDir, "runs"));
      await saved.load();
      assert.equal(saved.get(interrupted.id)?.status, "interrupted");
      assert.equal(saved.get(run.id)?.status, "completed");
      const analyses = new RecordStore<AnalysisResult>(
        join(dataDir, "analyses"),
      );
      await analyses.load();
      assert.equal(analyses.get(analysis.id)?.headCommit, analysis.headCommit);
    } finally {
      await app?.shutdown();
      // These directories were created under tmpdir by this test, never from user input.
      await removeTestDirectory(projectRoot);
    }
  },
);

test("static assets and SPA fallback reject canonical paths outside dist", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "faultline-api-"));
  const dist = join(projectRoot, "dist");
  const outside = join(projectRoot, "outside-assets");
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    await Promise.all([mkdir(dist), mkdir(outside)]);
    await Promise.all([
      writeFile(join(dist, "index.html"), "<main>Dashboard fixture</main>"),
      writeFile(join(dist, "asset.js"), "console.log('asset fixture');"),
      writeFile(join(outside, "sentinel.txt"), "INERT_OUTSIDE_SENTINEL"),
    ]);
    await symlink(
      outside,
      join(dist, "escaped"),
      process.platform === "win32" ? "junction" : "dir",
    );
    app = await createApp({
      projectRoot,
      dataDir: join(projectRoot, ".faultline"),
      demo: {
        repository: projectRoot,
        baseRef: "baseline",
        headRef: "candidate",
        name: "Static boundary fixture",
        description: "Inert test fixture; no experiment execution.",
      },
    });
    await new Promise<void>((done) =>
      app!.server.listen(0, "127.0.0.1", done),
    );
    const address = app.server.address();
    assert.ok(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}`;
    const asset = await fetch(url + "/asset.js");
    assert.equal(asset.status, 200);
    assert.equal(await asset.text(), "console.log('asset fixture');");
    const fallback = await fetch(url + "/workspace/history");
    assert.equal(fallback.status, 200);
    assert.equal(await fallback.text(), "<main>Dashboard fixture</main>");
    assert.equal((await fetch(url + "/api/missing")).status, 404);
    const escaped = await fetch(url + "/escaped/sentinel.txt");
    assert.equal(escaped.status, 403);
    assert.doesNotMatch(await escaped.text(), /INERT_OUTSIDE_SENTINEL/);
    await rm(join(dist, "index.html"));
    await symlink(
      outside,
      join(dist, "index.html"),
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.equal((await fetch(url + "/workspace/history")).status, 403);
  } finally {
    await app?.shutdown();
    await removeTestDirectory(projectRoot);
  }
});

async function apiFixture() {
  const projectRoot = await mkdtemp(join(tmpdir(), "faultline-api-"));
  const dataDir = join(projectRoot, ".faultline");
  const demo = await ensureDemo(projectRoot);
  const app = await createApp({ projectRoot, dataDir, demo });
  await new Promise<void>((done) => app.server.listen(0, "127.0.0.1", done));
  const address = app.server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}`;
  const get = (route: string) => fetch(url + route);
  const post = (route: string, value: unknown) =>
    fetch(url + route, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    });
  const response = await post("/api/analyses", {
    repository: demo.repository,
    baseRef: demo.baseRef,
    headRef: demo.headRef,
  });
  assert.equal(response.status, 201);
  const analysis = (await response.json()) as AnalysisResult;
  const waitForRun = async (run: ExperimentRun) => {
    const deadline = Date.now() + 15_000;
    while (run.status === "queued" || run.status === "running") {
      assert.ok(Date.now() < deadline, "run reached a terminal state");
      await new Promise((done) => setTimeout(done, 50));
      run = (await (await get(`/api/runs/${run.id}`)).json()) as ExperimentRun;
    }
    return run;
  };
  return { projectRoot, dataDir, app, url, get, post, analysis, waitForRun };
}

test(
  "terminal storage failure stays visible as memory-only failure and degrades the coordinator",
  { timeout: 30_000 },
  async () => {
    const f = await apiFixture();
    const originalPut = RecordStore.prototype.put;
    try {
      RecordStore.prototype.put = async function (value) {
        if ((value as Partial<ExperimentRun>).status === "completed")
          throw new Error("Injected terminal storage failure");
        await originalPut.call(this, value);
      };
      const response = await f.post("/api/runs", {
        analysisId: f.analysis.id,
        scenario: "healthy",
        requests: 5,
      });
      assert.equal(response.status, 202);
      const run = await f.waitForRun((await response.json()) as ExperimentRun);
      assert.equal(run.status, "failed");
      assert.equal(run.result, undefined);
      assert.match(run.error!, /only in memory/);
      assert.match(run.error!, /Injected terminal storage failure/);
      const health = (await (await f.get("/api/health")).json()) as Health;
      assert.equal(health.status, "degraded");
      assert.equal(health.activeRun, null);
      assert.equal(
        (
          await f.post("/api/runs", {
            analysisId: f.analysis.id,
            scenario: "healthy",
            requests: 5,
          })
        ).status,
        503,
      );
      assert.equal((await f.post("/api/analyses", {})).status, 503);
      assert.equal(
        (await f.post(`/api/runs/${run.id}/cancel`, {})).status,
        503,
      );
      const list = (await (await f.get("/api/runs")).json()) as ExperimentRun[];
      assert.equal(list.find((item) => item.id === run.id)?.status, "failed");
      const exported = await (await f.get(`/api/runs/${run.id}/export`)).json();
      assert.match(exported.run.error, /only in memory/);
      assert.equal(exported.run.result, undefined);
      const durable = new RecordStore<ExperimentRun>(join(f.dataDir, "runs"));
      await durable.load();
      assert.equal(durable.get(run.id)?.status, "running");
    } finally {
      RecordStore.prototype.put = originalPut;
      await f.app.shutdown();
      await removeTestDirectory(f.projectRoot);
    }
  },
);

test(
  "event storage failure is failed rather than user-cancelled and blocks further mutations",
  { timeout: 30_000 },
  async () => {
    const f = await apiFixture();
    const originalPut = RecordStore.prototype.put;
    let injected = false;
    try {
      RecordStore.prototype.put = async function (value) {
        const run = value as Partial<ExperimentRun>;
        if (!injected && run.status === "running" && run.events?.length) {
          injected = true;
          throw new Error("Injected event storage failure");
        }
        await originalPut.call(this, value);
      };
      const response = await f.post("/api/runs", {
        analysisId: f.analysis.id,
        scenario: "latency",
        requests: 5,
      });
      const run = await f.waitForRun((await response.json()) as ExperimentRun);
      assert.equal(run.status, "failed");
      assert.equal(run.result, undefined);
      assert.match(run.error!, /Injected event storage failure/);
      assert.equal(
        ((await (await f.get("/api/health")).json()) as Health).status,
        "degraded",
      );
      assert.equal(
        (
          await f.post("/api/runs", {
            analysisId: f.analysis.id,
            scenario: "healthy",
            requests: 5,
          })
        ).status,
        503,
      );
      const durable = new RecordStore<ExperimentRun>(join(f.dataDir, "runs"));
      await durable.load();
      assert.equal(durable.get(run.id)?.status, "failed");
    } finally {
      RecordStore.prototype.put = originalPut;
      await f.app.shutdown();
      await removeTestDirectory(f.projectRoot);
    }
  },
);

test(
  "shutdown rejects a run whose request body was still arriving",
  { timeout: 30_000 },
  async () => {
    const f = await apiFixture();
    try {
      const payload = JSON.stringify({
        analysisId: f.analysis.id,
        scenario: "healthy",
        requests: 5,
      });
      let incoming!: () => void;
      const received = new Promise<void>((done) => {
        incoming = done;
      });
      f.app.server.once("request", () => {
        incoming();
      });
      let client!: ReturnType<typeof request>;
      const response = new Promise<{
        status: number;
        value: { error?: string };
      }>((done, fail) => {
        client = request(
          f.url + "/api/runs",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(payload),
            },
          },
          (res) => {
            let output = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => {
              output += chunk;
            });
            res.on("end", () =>
              done({ status: res.statusCode!, value: JSON.parse(output) }),
            );
          },
        );
        client.once("error", fail);
        client.write(payload.slice(0, -1));
      });
      await received;
      const shutdown = f.app.shutdown();
      client.end(payload.slice(-1));
      const result = await response;
      assert.equal(result.status, 503);
      assert.match(result.value.error!, /shutting down/);
      await shutdown;
      const durable = new RecordStore<ExperimentRun>(join(f.dataDir, "runs"));
      await durable.load();
      assert.equal(durable.list().length, 0);
    } finally {
      await f.app.shutdown();
      await removeTestDirectory(f.projectRoot);
    }
  },
);

test(
  "shutdown owns and awaits a run still saving its queued record",
  { timeout: 30_000 },
  async () => {
    const f = await apiFixture();
    const originalPut = RecordStore.prototype.put;
    let queuedReached!: () => void;
    let releaseQueued!: () => void;
    let terminalReached!: () => void;
    let releaseTerminal!: () => void;
    const queued = new Promise<void>((done) => {
      queuedReached = done;
    });
    const queuedGate = new Promise<void>((done) => {
      releaseQueued = done;
    });
    const terminal = new Promise<void>((done) => {
      terminalReached = done;
    });
    const terminalGate = new Promise<void>((done) => {
      releaseTerminal = done;
    });
    try {
      RecordStore.prototype.put = async function (value) {
        const run = value as Partial<ExperimentRun>;
        if (run.status === "queued") {
          queuedReached();
          await queuedGate;
        }
        if (run.status === "cancelled") {
          terminalReached();
          await terminalGate;
        }
        await originalPut.call(this, value);
      };
      const submitted = f.post("/api/runs", {
        analysisId: f.analysis.id,
        scenario: "healthy",
        requests: 5,
      });
      await queued;
      let stopped = false;
      const shutdown = f.app.shutdown().then(() => {
        stopped = true;
      });
      releaseQueued();
      const response = await submitted;
      assert.equal(response.status, 202);
      const accepted = (await response.json()) as ExperimentRun;
      await terminal;
      await new Promise((done) => setTimeout(done, 25));
      assert.equal(
        stopped,
        false,
        "shutdown waits for terminal persistence, including a previously queued run",
      );
      releaseTerminal();
      await shutdown;
      const durable = new RecordStore<ExperimentRun>(join(f.dataDir, "runs"));
      await durable.load();
      assert.equal(durable.get(accepted.id)?.status, "cancelled");
      assert.equal(durable.get(accepted.id)?.result, undefined);
    } finally {
      releaseQueued();
      releaseTerminal();
      RecordStore.prototype.put = originalPut;
      await f.app.shutdown();
      await removeTestDirectory(f.projectRoot);
    }
  },
);
