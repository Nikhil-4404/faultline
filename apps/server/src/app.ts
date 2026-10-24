import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, join, extname, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { analyzeRepository } from "../../../packages/analyzer/src/index.ts";
import { ensureDemo } from "../../../packages/runner/src/demo.ts";
import { runExperiment } from "../../../packages/runner/src/index.ts";
import {
  SCENARIOS,
  type AnalysisResult,
  type ExperimentRun,
  type DemoProject,
  type ScenarioId,
} from "../../../packages/shared/src/index.ts";
import { RecordStore } from "./store.ts";

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
interface Options {
  projectRoot: string;
  dataDir: string;
  demo?: DemoProject;
  trustedPorts?: number[];
}
const latest = <T extends { createdAt: string }>(records: T[]) =>
  records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
const json = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(value));
};
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (
    !req.headers["content-type"]?.toLowerCase().startsWith("application/json")
  )
    throw new HttpError(415, "Use application/json.");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_384)
      throw new HttpError(413, "Request exceeds the 16 KB limit.");
    chunks.push(Buffer.from(chunk));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new HttpError(400, "Expected a JSON object.");
  return parsed as Record<string, unknown>;
}
function textField(value: unknown, name: string, max = 2048): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x1f]/.test(value)
  )
    throw new HttpError(
      400,
      `${name} must be a nonempty string (maximum ${max} characters).`,
    );
  return value.trim();
}
function trustedRequest(req: IncomingMessage, ports: number[]): void {
  const host = req.headers.host;
  if (
    !host ||
    !ports.some(
      (port) => host === `127.0.0.1:${port}` || host === `localhost:${port}`,
    )
  )
    throw new HttpError(403, "Only local dashboard requests are accepted.");
  const origin = req.headers.origin;
  if (
    origin &&
    !ports.some(
      (port) =>
        origin === `http://127.0.0.1:${port}` ||
        origin === `http://localhost:${port}`,
    )
  )
    throw new HttpError(403, "Cross-origin requests are rejected.");
  if (req.headers["sec-fetch-site"] === "cross-site")
    throw new HttpError(403, "Cross-site requests are rejected.");
}

export async function createApp(options: Options) {
  const demo = options.demo ?? (await ensureDemo(options.projectRoot));
  const analyses = new RecordStore<AnalysisResult>(
    join(options.dataDir, "analyses"),
  );
  const runs = new RecordStore<ExperimentRun>(join(options.dataDir, "runs"));
  await Promise.all([analyses.load(), runs.load()]);
  for (const run of runs.list()) {
    if (run.status === "running" || run.status === "queued") {
      run.status = "interrupted";
      run.finishedAt = new Date().toISOString();
      run.error =
        "The coordinator stopped before this experiment finished. Start a new run; partial results are not compared.";
      await runs.put(run);
    }
  }
  let active: {
    id: string;
    controller: AbortController;
    completion: Promise<void>;
  } | null = null;
  let analyzing = false;
  let stopping = false;
  let storageFailure: string | null = null;
  const memoryOnlyRuns = new Map<string, ExperimentRun>();
  const listRuns = () => [
    ...runs.list().filter((run) => !memoryOnlyRuns.has(run.id)),
    ...[...memoryOnlyRuns.values()].map((run) => structuredClone(run)),
  ];
  const getRun = (id: string) =>
    memoryOnlyRuns.has(id)
      ? structuredClone(memoryOnlyRuns.get(id)!)
      : runs.get(id);
  const storageError = (error: unknown) => {
    storageFailure ??= `Evidence storage failed: ${error instanceof Error ? error.message : "Storage unavailable"}. Restore storage and restart the coordinator before starting more work.`;
    return storageFailure;
  };
  const memoryOnlyFailure = (run: ExperimentRun, error: unknown) => {
    run.status = "failed";
    run.result = undefined;
    run.finishedAt = new Date().toISOString();
    run.error = `${storageError(error)} This failed record exists only in memory and will not survive restart; no durable comparison was saved.`;
    memoryOnlyRuns.set(run.id, structuredClone(run));
  };
  const assertWritable = () => {
    if (stopping) throw new HttpError(503, "Coordinator is shutting down.");
    if (storageFailure) throw new HttpError(503, storageFailure);
  };
  const execute = async (
    run: ExperimentRun,
    analysis: AnalysisResult,
    controller: AbortController,
  ) => {
    let persistenceError: unknown;
    try {
      run.status = "running";
      run.startedAt = new Date().toISOString();
      try {
        await runs.put(run);
      } catch (error) {
        persistenceError = error;
        throw error;
      }
      const pendingWrites: Promise<void>[] = [];
      run.result = await runExperiment({
        fixtureRepository: demo.repository,
        workDir: join(options.dataDir, "work", run.id),
        scenario: run.scenario,
        requests: run.requests,
        signal: controller.signal,
        baselineCommit: analysis.baseCommit,
        candidateCommit: analysis.headCommit,
        onEvent: (event) => {
          run.events.push(event);
          pendingWrites.push(
            runs.put(run).catch((error) => {
              persistenceError = error;
              storageError(error);
              controller.abort(error);
              throw error;
            }),
          );
          void pendingWrites.at(-1)?.catch(() => {});
        },
      });
      await Promise.all(pendingWrites);
      if (persistenceError) throw persistenceError;
      if (controller.signal.aborted) {
        run.result = undefined;
        run.status = "cancelled";
      } else run.status = "completed";
    } catch (error) {
      run.status =
        controller.signal.aborted && !persistenceError ? "cancelled" : "failed";
      run.error = persistenceError
        ? storageError(persistenceError)
        : error instanceof Error
          ? error.message
          : "Experiment failed.";
      run.result = undefined;
    } finally {
      run.finishedAt = new Date().toISOString();
      try {
        await runs.put(run);
      } catch (error) {
        memoryOnlyFailure(run, error);
      }
    }
  };
  const server = createServer(async (req, res) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("x-frame-options", "DENY");
    res.setHeader(
      "content-security-policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    try {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 4317;
      trustedRequest(req, [
        ...new Set([4317, 5173, port, ...(options.trustedPorts ?? [])]),
      ]);
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const path = url.pathname;
      const method = req.method ?? "GET";
      if (method !== "GET" && method !== "HEAD") assertWritable();
      if (path === "/api/health" && method === "GET")
        return json(res, 200, {
          status: storageFailure ? "degraded" : "ok",
          version: "1.0.0",
          runner: "local-process",
          activeRun: active?.id ?? null,
        });
      if (path === "/api/demo" && method === "GET") return json(res, 200, demo);
      if (path === "/api/scenarios" && method === "GET")
        return json(res, 200, SCENARIOS);
      if (path === "/api/analyses" && method === "GET")
        return json(res, 200, latest(analyses.list()));
      if (path === "/api/analyses" && method === "POST") {
        const input = await body(req);
        assertWritable();
        if (analyzing)
          throw new HttpError(
            409,
            "An analysis is already running. Try again when it finishes.",
          );
        const repository = textField(input.repository, "repository");
        const baseRef = textField(input.baseRef, "baseRef", 200);
        const headRef = textField(input.headRef, "headRef", 200);
        if (analyses.list().length >= 1000)
          throw new HttpError(
            409,
            "Analysis history is full. Archive records from .faultline/analyses before continuing.",
          );
        analyzing = true;
        try {
          const analysis = await analyzeRepository({
            repository,
            baseRef,
            headRef,
          });
          const normalize = (value: string) =>
            process.platform === "win32" ? value.toLowerCase() : value;
          analysis.experimentEligible =
            normalize(await realpath(repository)) ===
              normalize(await realpath(demo.repository)) &&
            baseRef === demo.baseRef &&
            headRef === demo.headRef;
          assertWritable();
          try {
            await analyses.put(analysis);
          } catch (error) {
            throw new HttpError(503, storageError(error));
          }
          return json(res, 201, analysis);
        } finally {
          analyzing = false;
        }
      }
      if (path === "/api/runs" && method === "GET")
        return json(res, 200, latest(listRuns()));
      if (path === "/api/runs" && method === "POST") {
        const input = await body(req);
        assertWritable();
        if (active)
          throw new HttpError(
            409,
            "Another experiment is running. Cancel it or wait for completion.",
          );
        const analysisId = textField(input.analysisId, "analysisId", 36);
        const analysis = analyses.get(analysisId);
        if (!analysis) throw new HttpError(404, "Analysis not found.");
        if (!analysis.experimentEligible)
          throw new HttpError(
            422,
            "Only the bundled checkout reference application can execute experiments. External repositories support read-only analysis.",
          );
        const scenario = input.scenario;
        if (!SCENARIOS.some((value) => value.id === scenario))
          throw new HttpError(400, "Unknown fault scenario.");
        const requests = input.requests ?? 12;
        if (
          typeof requests !== "number" ||
          !Number.isInteger(requests) ||
          requests < 5 ||
          requests > 100
        )
          throw new HttpError(
            400,
            "requests must be an integer from 5 to 100.",
          );
        if (listRuns().length >= 1000)
          throw new HttpError(
            409,
            "Experiment history is full. Archive saved runs before continuing.",
          );
        const run: ExperimentRun = {
          id: randomUUID(),
          analysisId,
          scenario: scenario as ScenarioId,
          requests,
          status: "queued",
          createdAt: new Date().toISOString(),
          events: [],
        };
        const controller = new AbortController();
        let accepted!: () => void;
        let rejected!: (error: unknown) => void;
        const queued = new Promise<void>((yes, no) => {
          accepted = yes;
          rejected = no;
        });
        // Install ownership before the queued save yields so shutdown can await the whole lifecycle.
        const completion = Promise.resolve()
          .then(async () => {
            try {
              await runs.put(run);
            } catch (error) {
              memoryOnlyFailure(run, error);
              rejected(new HttpError(503, storageFailure!));
              return;
            }
            accepted();
            await execute(run, analysis, controller);
          })
          .finally(() => {
            active = null;
          });
        active = { id: run.id, controller, completion };
        await queued;
        return json(res, 202, run);
      }
      const runRoute =
        /^\/api\/runs\/([a-f0-9-]{36})(?:\/(cancel|export))?$/.exec(path);
      if (runRoute) {
        const run = getRun(runRoute[1]);
        if (!run) throw new HttpError(404, "Experiment not found.");
        if (method === "POST" && runRoute[2] === "cancel") {
          await body(req);
          assertWritable();
          if (active?.id === run.id) active.controller.abort();
          return json(res, 200, getRun(run.id));
        }
        if (method === "GET" && runRoute[2] === "export") {
          res.setHeader(
            "content-disposition",
            `attachment; filename="faultline-${run.id}.json"`,
          );
          return json(res, 200, {
            schemaVersion: 1,
            exportedAt: new Date().toISOString(),
            run,
            analysis: analyses.get(run.analysisId),
            limitations: [
              "Application-level fault injection on loopback HTTP, not OS-level network partitioning.",
              "Local processes are disposable but are not a security sandbox.",
              "Measurements apply only to this workload and environment.",
            ],
          });
        }
        if (method === "GET" && !runRoute[2]) return json(res, 200, run);
      }
      if (path.startsWith("/api/"))
        throw new HttpError(404, "API endpoint not found.");
      if (method !== "GET" && method !== "HEAD")
        throw new HttpError(405, "Method not allowed.");
      const dist = resolve(options.projectRoot, "dist");
      let file = resolve(dist, `.${decodeURIComponent(path)}`);
      if (file !== dist && !file.startsWith(dist + sep))
        throw new HttpError(403, "Invalid asset path.");
      try {
        if (!(await stat(file)).isFile()) file = join(dist, "index.html");
      } catch {
        file = join(dist, "index.html");
      }
      let bytes: Buffer;
      try {
        bytes = await readFile(file);
      } catch {
        throw new HttpError(
          503,
          "Dashboard is not built. Run npm run build, then reload.",
        );
      }
      const mime: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".ico": "image/x-icon",
      };
      res.writeHead(200, {
        "content-type": mime[extname(file)] ?? "application/octet-stream",
        "cache-control":
          extname(file) === ".html" ? "no-cache" : "public, max-age=3600",
      });
      res.end(method === "HEAD" ? undefined : bytes);
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      const status =
        error instanceof HttpError
          ? error.status
          : error instanceof URIError
            ? 400
            : 422;
      json(res, status, {
        error: error instanceof Error ? error.message : "Request failed.",
      });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return {
    server,
    async shutdown() {
      stopping = true;
      const completion = active?.completion;
      active?.controller.abort();
      await completion;
      const flushed = await Promise.allSettled([
        analyses.flush(),
        runs.flush(),
      ]);
      for (const result of flushed)
        if (result.status === "rejected") storageError(result.reason);
      if (server.listening)
        await new Promise<void>((done, reject) =>
          server.close((error) => (error ? reject(error) : done())),
        );
    },
  };
}
