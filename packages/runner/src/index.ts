import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  SCENARIOS,
  type ExperimentResult,
  type Finding,
  type RunEvent,
  type ScenarioId,
  type TraceRecord,
  type VariantResult,
} from "../../shared/src/index.ts";
import { verifiedSnapshot } from "./fixture.ts";

interface ExperimentInput {
  fixtureRepository: string;
  workDir: string;
  scenario: ScenarioId;
  requests: number;
  baselineCommit?: string;
  candidateCommit?: string;
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => void;
}
interface ServiceState {
  traces: TraceRecord[];
  reservations?: string[];
  charges?: { orderId: string; idempotencyKey: string; amount: number }[];
}

function percentile(values: number[], fraction: number) {
  return (
    Math.round(
      [...values].sort((a, b) => a - b)[
        Math.max(0, Math.ceil(values.length * fraction) - 1)
      ] * 100,
    ) / 100
  );
}

async function stopChild(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  await new Promise<void>((done, fail) => {
    const force = setTimeout(() => child.kill("SIGKILL"), 700);
    force.unref();
    const timeout = setTimeout(() => {
      child.removeListener("exit", exited);
      fail(
        new Error(`Child ${child.pid} did not exit after forced termination`),
      );
    }, 3000);
    const exited = () => {
      clearTimeout(force);
      clearTimeout(timeout);
      done();
    };
    child.once("exit", exited);
    child.kill();
  });
}

async function startService(
  directory: string,
  service: string,
  env: NodeJS.ProcessEnv,
  children: ChildProcess[],
  controller: AbortController,
  isStopping: () => boolean,
): Promise<string> {
  controller.signal.throwIfAborted();
  return new Promise<string>((ready, fail) => {
    const child = spawn(
      process.execPath,
      [join(directory, "src", "services", `${service}.mjs`)],
      {
        cwd: directory,
        env: { ...process.env, ...env },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    children.push(child);
    let stderr = "";
    let initialized = false;
    child.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });
    child.stdout?.resume();
    const aborted = () => {
      clearTimeout(timeout);
      fail(controller.signal.reason);
    };
    const timeout = setTimeout(() => {
      const error = new Error(
        `${service} did not become ready within 8 seconds. ${stderr}`,
      );
      controller.abort(error);
    }, 8000);
    controller.signal.addEventListener("abort", aborted, { once: true });
    child.once("error", (error) => {
      clearTimeout(timeout);
      controller.abort(error);
      fail(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      controller.signal.removeEventListener("abort", aborted);
      if (!isStopping()) {
        const error = new Error(
          `${service} exited unexpectedly (${code ?? signal}). ${stderr}`,
        );
        controller.abort(error);
        fail(error);
      }
    });
    child.on("message", (message: unknown) => {
      const value = message as { type?: string; port?: number };
      if (
        !initialized &&
        value?.type === "ready" &&
        Number.isInteger(value.port) &&
        value.port! > 0 &&
        value.port! <= 65535
      ) {
        initialized = true;
        clearTimeout(timeout);
        ready(`http://127.0.0.1:${value.port}`);
      }
    });
  });
}

async function runVariant(
  variant: "baseline" | "candidate",
  files: Map<string, string>,
  input: ExperimentInput,
  emit: (phase: string, message: string) => void,
): Promise<VariantResult> {
  const workRoot = resolve(input.workDir);
  await mkdir(workRoot, { recursive: true });
  const directory = await mkdtemp(join(workRoot, "faultline-"));
  const children: ChildProcess[] = [];
  const controller = new AbortController();
  const cancelled = () =>
    controller.abort(new DOMException("Experiment cancelled", "AbortError"));
  input.signal?.addEventListener("abort", cancelled, { once: true });
  if (input.signal?.aborted) cancelled();
  let stopping = false;
  try {
    for (const [path, source] of files) {
      controller.signal.throwIfAborted();
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await writeFile(join(directory, path), source, "utf8");
    }
    emit(
      variant,
      `Starting ${variant}: checkout, inventory and payments as real local HTTP processes.`,
    );
    const inventory = await startService(
      directory,
      "inventory",
      {},
      children,
      controller,
      () => stopping,
    );
    const payments = await startService(
      directory,
      "payments",
      { SCENARIO: input.scenario },
      children,
      controller,
      () => stopping,
    );
    const checkout = await startService(
      directory,
      "checkout",
      { INVENTORY_URL: inventory, PAYMENTS_URL: payments },
      children,
      controller,
      () => stopping,
    );
    const durations: number[] = [];
    let successes = 0;
    let next = 0;
    const started = performance.now();
    emit(
      variant,
      `Sending ${input.requests} order requests with concurrency 4; scenario: ${input.scenario}.`,
    );
    await Promise.all(
      Array.from({ length: Math.min(4, input.requests) }, async () => {
        while (next < input.requests) {
          controller.signal.throwIfAborted();
          const order = ++next;
          const requestId = `order-${String(order).padStart(4, "0")}`;
          const start = performance.now();
          const response = await fetch(`${checkout}/checkout`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ orderId: requestId }),
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(4000),
            ]),
          });
          const outcome = (await response.json()) as { status?: string };
          if (response.ok && outcome.status === "completed") successes++;
          durations.push(performance.now() - start);
        }
      }),
    );
    const durationMs = Math.round((performance.now() - started) * 100) / 100;
    const states = await Promise.all(
      [checkout, inventory, payments].map(async (url) => {
        const response = await fetch(`${url}/_state`, {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(2000),
          ]),
        });
        if (!response.ok) throw new Error(`Cannot read evidence from ${url}`);
        return (await response.json()) as ServiceState;
      }),
    );
    const charges = states[2].charges!;
    const duplicateCharges =
      charges.length - new Set(charges.map((charge) => charge.orderId)).size;
    const failures = input.requests - successes;
    const result: VariantResult = {
      variant,
      requests: input.requests,
      successes,
      failures,
      errorRate: failures / input.requests,
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      totalCharges: charges.length,
      duplicateCharges,
      inventoryReservations: states[1].reservations!.length,
      durationMs,
      traces: states
        .flatMap((state) => state.traces)
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    };
    emit(
      variant,
      `${variant}: ${successes}/${input.requests} successful, ${charges.length} charges, ${duplicateCharges} duplicates.`,
    );
    return result;
  } finally {
    stopping = true;
    controller.abort();
    input.signal?.removeEventListener("abort", cancelled);
    await Promise.all(children.map(stopChild));
    // Delete only the unique directory created by this invocation, never the caller's work directory.
    if (
      dirname(directory) !== workRoot ||
      !basename(directory).startsWith("faultline-")
    )
      throw new Error("Unsafe cleanup path refused");
    await rm(directory, { recursive: true, force: true });
  }
}

export async function runExperiment(
  input: ExperimentInput,
): Promise<ExperimentResult> {
  if (
    !Number.isInteger(input.requests) ||
    input.requests < 5 ||
    input.requests > 100
  )
    throw new Error("Requests must be an integer from 5 to 100");
  const scenario = SCENARIOS.find((item) => item.id === input.scenario);
  if (!scenario) throw new Error("Unknown fault scenario");
  if (input.signal?.aborted)
    throw new DOMException("Experiment cancelled", "AbortError");
  const emit = (phase: string, message: string) =>
    input.onEvent?.({ time: new Date().toISOString(), phase, message });
  emit(
    "preparing",
    "Verifying and pinning both controlled Git snapshots before executing any source.",
  );
  const baselineSnapshot = await verifiedSnapshot(
    input.fixtureRepository,
    input.baselineCommit ?? "baseline",
    "baseline",
  );
  const candidateSnapshot = await verifiedSnapshot(
    input.fixtureRepository,
    input.candidateCommit ?? "candidate",
    "candidate",
  );
  emit(
    "preparing",
    `Pinned baseline ${baselineSnapshot.commit.slice(0, 8)} and candidate ${candidateSnapshot.commit.slice(0, 8)}. The same order IDs and per-order fault rule apply to both.`,
  );
  try {
    const baseline = await runVariant(
      "baseline",
      baselineSnapshot.files,
      input,
      emit,
    );
    const candidate = await runVariant(
      "candidate",
      candidateSnapshot.files,
      input,
      emit,
    );
    const findings: Finding[] = [];
    let verdict: ExperimentResult["verdict"] = "no-regression";
    if (candidate.duplicateCharges > baseline.duplicateCharges) {
      verdict = "regression";
      findings.push({
        severity: "critical",
        title: "Retry regression duplicates committed payments",
        detail:
          "The acknowledgement was lost after commit. The changed payment key creates a new charge on retry; the baseline reuses the original charge.",
        evidence: [
          `Baseline duplicate charges: ${baseline.duplicateCharges}`,
          `Candidate duplicate charges: ${candidate.duplicateCharges}`,
          `Candidate charges / orders: ${candidate.totalCharges} / ${candidate.requests}`,
          "Inspect payments traces for the same order with attempt-specific keys.",
        ],
      });
    }
    if (candidate.failures > baseline.failures) {
      verdict = "regression";
      findings.push({
        severity: "warning",
        title: "More checkout requests failed in the candidate",
        detail:
          "The candidate returned fewer successful checkouts under this workload. Inspect traces before assigning a cause.",
        evidence: [
          `Baseline failures: ${baseline.failures}`,
          `Candidate failures: ${candidate.failures}`,
        ],
      });
    }
    if (
      baseline.failures === baseline.requests &&
      candidate.failures === candidate.requests
    ) {
      verdict = "inconclusive";
      findings.push({
        severity: "warning",
        title: "Dependency outage prevents successful checkout",
        detail:
          "Both revisions failed every checkout. This confirms outage handling but cannot establish payment-retry safety after a successful commit.",
        evidence: [
          `Baseline / candidate charges: ${baseline.totalCharges} / ${candidate.totalCharges}`,
          `Remaining inventory reservations: ${baseline.inventoryReservations} / ${candidate.inventoryReservations}`,
        ],
      });
    }
    if (findings.length === 0)
      findings.push({
        severity: "info",
        title: "No correctness regression observed in this scenario",
        detail:
          "This conclusion covers only this bounded workload and fault rule. Local timing differences are measurements, not a causal performance verdict.",
        evidence: [
          `Successful checkouts: ${baseline.successes} / ${candidate.successes}`,
          `Duplicate charges: ${baseline.duplicateCharges} / ${candidate.duplicateCharges}`,
        ],
      });
    emit(
      "reporting",
      `Evidence comparison complete: ${verdict}. All child processes and disposable snapshots have been cleaned up.`,
    );
    return {
      baseline,
      candidate,
      verdict,
      findings,
      environment: {
        kind: "local-process",
        faultMechanism: scenario.mechanism,
        isolation:
          "Separate Node processes, loopback ephemeral ports and disposable source copies. Controlled fixture only; processes are not a container or security sandbox.",
      },
    };
  } catch (error) {
    if (input.signal?.aborted)
      throw new DOMException("Experiment cancelled", "AbortError");
    throw error;
  }
}
