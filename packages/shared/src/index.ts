export type ScenarioId =
  "healthy" | "latency" | "connection-reset" | "dependency-down";
export interface Scenario {
  id: ScenarioId;
  name: string;
  description: string;
  mechanism: string;
}
export const SCENARIOS: Scenario[] = [
  {
    id: "connection-reset",
    name: "Lost acknowledgement",
    description:
      "Payment commits, then its first response is lost. Do retries duplicate a charge?",
    mechanism:
      "The payment service destroys its socket after recording the first charge for each order.",
  },
  {
    id: "latency",
    name: "Slow dependency",
    description:
      "The first payment response exceeds the checkout timeout. Does a retry stay safe?",
    mechanism:
      "The payment service delays its first response beyond the client timeout.",
  },
  {
    id: "dependency-down",
    name: "Dependency outage",
    description:
      "Payments are unavailable throughout the workload. Inspect failure handling.",
    mechanism:
      "The payment service returns HTTP 503 before processing a charge.",
  },
  {
    id: "healthy",
    name: "Healthy control",
    description: "Run both revisions without faults to establish a control.",
    mechanism: "No faults are injected.",
  },
];
export interface DemoProject {
  repository: string;
  name: string;
  baseRef: string;
  headRef: string;
  description: string;
}
export interface ChangedSymbol {
  name: string;
  kind: string;
  line: number;
  endLine: number;
}
export interface FileChange {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  symbols: ChangedSymbol[];
  patch: string;
}
export interface GraphNode {
  id: string;
  path: string;
  label: string;
  service: string;
  status: "changed" | "impacted" | "unaffected";
  symbols: string[];
}
export interface GraphEdge {
  source: string;
  target: string;
  kind: "import" | "call";
  label?: string;
}
export interface Impact {
  path: string;
  reason: string;
  chain: string[];
  distance: number;
}
export interface AnalysisInput {
  repository: string;
  baseRef: string;
  headRef: string;
}
export interface AnalysisResult extends AnalysisInput {
  id: string;
  createdAt: string;
  repositoryName: string;
  baseCommit: string;
  headCommit: string;
  summary: {
    filesChanged: number;
    symbolsChanged: number;
    impactedFiles: number;
    totalFiles: number;
  };
  changes: FileChange[];
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  impacts: Impact[];
  recommendations: ScenarioId[];
  warnings: string[];
  experimentEligible: boolean;
}
export interface RunEvent {
  time: string;
  message: string;
  phase: string;
}
export interface TraceRecord {
  requestId: string;
  service: string;
  operation: string;
  startedAt: string;
  durationMs: number;
  status: "ok" | "error";
  detail: string;
}
export interface VariantResult {
  variant: "baseline" | "candidate";
  requests: number;
  successes: number;
  failures: number;
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  totalCharges: number;
  duplicateCharges: number;
  inventoryReservations: number;
  durationMs: number;
  traces: TraceRecord[];
}
export interface Finding {
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  evidence: string[];
}
export interface ExperimentResult {
  baseline: VariantResult;
  candidate: VariantResult;
  verdict: "regression" | "no-regression" | "inconclusive";
  findings: Finding[];
  environment: {
    kind: "local-process";
    faultMechanism: string;
    isolation: string;
  };
}
export type RunStatus =
  "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
export interface ExperimentRun {
  id: string;
  analysisId: string;
  scenario: ScenarioId;
  requests: number;
  status: RunStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  events: RunEvent[];
  result?: ExperimentResult;
  error?: string;
}
export interface Health {
  status: string;
  version: string;
  runner: string;
  activeRun: string | null;
}
