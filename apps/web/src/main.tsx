import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  SCENARIOS,
  type AnalysisInput,
  type AnalysisResult,
  type DemoProject,
  type ExperimentRun,
  type GraphNode,
  type Health,
  type ScenarioId,
} from "../../../packages/shared/src/index";
import "./styles.css";

type Page = "impact" | "tunnel" | "evidence" | "architecture";
type IconName =
  | "bolt"
  | "graph"
  | "wind"
  | "stack"
  | "layers"
  | "arrow"
  | "chevron"
  | "check"
  | "close"
  | "refresh"
  | "download"
  | "folder"
  | "branch"
  | "play"
  | "stop"
  | "clock"
  | "terminal"
  | "alert"
  | "code";
const icons: Record<IconName, ReactNode> = {
  bolt: <path d="m14 2-9 11h7l-2 9 9-12h-7z" />,
  graph: (
    <>
      <circle cx="5" cy="6" r="2" />
      <circle cx="19" cy="6" r="2" />
      <circle cx="12" cy="18" r="2" />
      <path d="m7 7 4 9m6-9-4 9M7 6h10" />
    </>
  ),
  wind: (
    <>
      <path d="M3 8h12a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h5a3 3 0 1 1-3 3" />
    </>
  ),
  stack: (
    <>
      <path d="m3 7 9-5 9 5-9 5zM3 12l9 5 9-5M3 17l9 5 9-5" />
    </>
  ),
  layers: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  refresh: (
    <>
      <path d="M20 7V3l-3 3a8 8 0 1 0 3 9M20 3h-5" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" />
    </>
  ),
  folder: <path d="M3 6V4h6l2 3h10v13H3z" />,
  branch: (
    <>
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="5" r="2" />
      <path d="M6 7v10m12-10v2a5 5 0 0 1-5 5H6" />
    </>
  ),
  play: <path d="m8 4 12 8-12 8z" />,
  stop: <rect x="5" y="5" width="14" height="14" rx="1" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  terminal: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m6 8 4 4-4 4m7 0h5" />
    </>
  ),
  alert: (
    <>
      <path d="m12 3 10 18H2zM12 9v5" />
      <path d="M12 17h.01" />
    </>
  ),
  code: (
    <>
      <path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18" />
    </>
  ),
};
function Icon({
  name,
  size = 18,
  className = "",
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name]}
    </svg>
  );
}
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    `/api${path}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : data.error?.message ||
            data.message ||
            `Request failed (${response.status})`,
    );
  return data;
}
const active = (run: ExperimentRun) =>
  run.status === "queued" || run.status === "running";
const stamp = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const short = (value: string) =>
  value === "WORKTREE" ? "working tree" : value.slice(0, 8);
const basename = (path: string) =>
  path.replaceAll("\\", "/").split("/").pop() || path;
const formatMs = (n: number) => `${Math.round(n).toLocaleString()} ms`;
const label = (status: string) => status.replaceAll("-", " ");

function App() {
  const [page, setPage] = useState<Page>("impact");
  const [demo, setDemo] = useState<DemoProject | null>(null);
  const [analyses, setAnalyses] = useState<AnalysisResult[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [input, setInput] = useState<AnalysisInput>({
    repository: "",
    baseRef: "baseline",
    headRef: "candidate",
  });
  const [runs, setRuns] = useState<ExperimentRun[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [scenario, setScenario] = useState<ScenarioId>("connection-reset");
  const [requests, setRequests] = useState("12");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const run = runs.find((r) => r.id === runId) || null;
  const tunnelRun =
    run?.analysisId === analysis?.id
      ? run
      : runs.find((r) => r.analysisId === analysis?.id) || null;
  const validWorkload =
    Number.isInteger(Number(requests)) &&
    Number(requests) >= 5 &&
    Number(requests) <= 100;
  const running = runs.find(active);
  const storageUnavailable = health?.status === "degraded";
  const currentScenario = SCENARIOS.find((s) => s.id === scenario)!;

  function chooseAnalysis(value: AnalysisResult) {
    setAnalysis(value);
    setInput({
      repository: value.repository,
      baseRef: value.baseRef,
      headRef: value.headRef,
    });
    setSelectedNode(
      value.graph.nodes.find((n) => n.status === "changed")?.id ||
        value.graph.nodes[0]?.id ||
        null,
    );
    setSelectedFile(value.changes[0]?.path || null);
  }
  async function syncHealth() {
    try {
      setHealth(await api<Health>("/health"));
    } catch {
      setHealth(null);
    }
  }
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [d, a, r, h] = await Promise.all([
          api<DemoProject>("/demo"),
          api<AnalysisResult[]>("/analyses"),
          api<ExperimentRun[]>("/runs"),
          api<Health>("/health"),
        ]);
        if (!mounted) return;
        setDemo(d);
        setRuns(r);
        setHealth(h);
        setRunId(r.find(active)?.id || r[0]?.id || null);
        setInput({
          repository: d.repository,
          baseRef: d.baseRef,
          headRef: d.headRef,
        });
        if (a.length) {
          setAnalyses(a);
          chooseAnalysis(a[0]);
        } else if (h.status !== "degraded") {
          setAnalyzing(true);
          const first = await api<AnalysisResult>("/analyses", {
            repository: d.repository,
            baseRef: d.baseRef,
            headRef: d.headRef,
          });
          if (mounted) {
            setAnalyses([first]);
            chooseAnalysis(first);
          }
        }
      } catch (e) {
        if (mounted) {
          setError((e as Error).message);
          await syncHealth();
        }
      } finally {
        if (mounted) {
          setLoading(false);
          setAnalyzing(false);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    const ids = runs.filter(active).map((r) => r.id);
    if (!ids.length) return;
    let disposed = false;
    const timer = window.setInterval(async () => {
      try {
        const [updates, currentHealth] = await Promise.all([
          Promise.all(ids.map((id) => api<ExperimentRun>(`/runs/${id}`))),
          api<Health>("/health"),
        ]);
        if (!disposed) {
          setRuns((old) =>
            old.map((r) => updates.find((u) => u.id === r.id) || r),
          );
          setHealth(currentHealth);
        }
      } catch (e) {
        if (!disposed) {
          setError(`Could not refresh the experiment: ${(e as Error).message}`);
          await syncHealth();
        }
      }
    }, 1200);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [
    runs
      .filter(active)
      .map((r) => r.id)
      .join(","),
  ]);

  async function analyze(event?: FormEvent) {
    event?.preventDefault();
    if (storageUnavailable) return;
    setError("");
    setAnalyzing(true);
    try {
      const value = await api<AnalysisResult>("/analyses", input);
      setAnalyses((old) => [value, ...old]);
      chooseAnalysis(value);
    } catch (e) {
      setError((e as Error).message);
      await syncHealth();
    } finally {
      setAnalyzing(false);
    }
  }
  async function startRun() {
    if (!analysis || storageUnavailable) return;
    setError("");
    setStarting(true);
    try {
      const value = await api<ExperimentRun>("/runs", {
        analysisId: analysis.id,
        scenario,
        requests: Number(requests),
      });
      setRuns((old) => [value, ...old]);
      setRunId(value.id);
    } catch (e) {
      setError((e as Error).message);
      await syncHealth();
    } finally {
      setStarting(false);
    }
  }
  async function cancelRun(value: ExperimentRun) {
    try {
      const cancelled = await api<ExperimentRun>(
        `/runs/${value.id}/cancel`,
        {},
      );
      setRuns((old) => old.map((r) => (r.id === cancelled.id ? cancelled : r)));
    } catch (e) {
      setError((e as Error).message);
      await syncHealth();
    }
  }
  async function refresh() {
    setRefreshing(true);
    setError("");
    try {
      const [r, h] = await Promise.all([
        api<ExperimentRun[]>("/runs"),
        api<Health>("/health"),
      ]);
      setRuns(r);
      setHealth(h);
    } catch (e) {
      setError((e as Error).message);
      await syncHealth();
    } finally {
      setRefreshing(false);
    }
  }
  const titles: Record<Page, [string, string, string]> = {
    impact: [
      "01",
      "Change impact",
      "Follow the change. Understand the ripple.",
    ],
    tunnel: ["02", "Wind tunnel", "Put your assumptions under pressure."],
    evidence: ["03", "Evidence runs", "Every conclusion needs a paper trail."],
    architecture: [
      "04",
      "Under the hood",
      "A transparent path from code to evidence.",
    ],
  };
  const nav: [Page, IconName, string][] = [
    ["impact", "graph", "Impact explorer"],
    ["tunnel", "wind", "Wind tunnel"],
    ["evidence", "stack", "Evidence runs"],
    ["architecture", "layers", "Architecture"],
  ];

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="bolt" size={25} />
          </span>
          <span>
            faultline<span className="brand-period">.</span>
          </span>
        </div>
        <div className="workspace-label">ENGINEERING WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav.map(([key, icon, title]) => (
            <button
              key={key}
              aria-label={title}
              title={title}
              className={`nav-item ${page === key ? "selected" : ""}`}
              onClick={() => setPage(key)}
              aria-current={page === key ? "page" : undefined}
            >
              <Icon name={icon} />
              <span>{title}</span>
              {key === "evidence" && runs.length > 0 && (
                <span className="nav-count">{runs.length}</span>
              )}
              {page === key && key !== "evidence" && (
                <span className="nav-dot" />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="sidebar-note-icon">
            <Icon name="terminal" />
          </div>
          <strong>Your machine. Real failures.</strong>
          <p>
            Inspect code locally. Execute controlled faults in isolated
            processes.
          </p>
          <span className="sidebar-tag">
            <span className="live-dot" /> LOCAL WORKSPACE
          </span>
        </div>
        <div className="sidebar-bottom">
          <span className="avatar">FL</span>
          <div>
            <strong>Faultline Lab</strong>
            <span>Local development · v1.0</span>
          </div>
          <Icon name="code" size={16} />
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <Icon name="chevron" size={13} />
            <strong>{titles[page][1]}</strong>
          </div>
          <div className="topbar-tools">
            <span
              className={`runner-status ${storageUnavailable ? "degraded" : ""}`}
            >
              <span
                className={`live-dot ${storageUnavailable ? "degraded" : health ? "" : "offline"}`}
              />
              {storageUnavailable
                ? "Storage unavailable"
                : running
                  ? "Experiment running"
                  : health
                    ? "Local runner ready"
                    : "Connecting to runner"}
            </span>
            <button
              className="icon-button"
              title="Refresh runner and experiments"
              aria-label="Refresh runner and experiments"
              onClick={refresh}
              disabled={refreshing}
            >
              <Icon name="refresh" className={refreshing ? "spin" : ""} />
            </button>
          </div>
        </header>
        <main id="main">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span>{titles[page][0]}</span> /{" "}
                {page === "architecture"
                  ? "SYSTEM DESIGN"
                  : "CHANGE INTELLIGENCE"}
              </div>
              <h1>
                {titles[page][1]}
                <span className="orange">.</span>
              </h1>
              <p>{titles[page][2]}</p>
            </div>
            {page === "impact" && analysis && (
              <button
                className="button button-dark heading-action"
                onClick={() => setPage("tunnel")}
              >
                Open wind tunnel <Icon name="arrow" size={17} />
              </button>
            )}
            {page === "evidence" && (
              <span className="heading-stat">
                <strong>{runs.length.toString().padStart(2, "0")}</strong>{" "}
                recorded experiments
              </span>
            )}
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <Icon name="alert" />
              <span>{error}</span>
              <button
                className="icon-button"
                onClick={() => setError("")}
                aria-label="Dismiss error"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          )}
          {storageUnavailable && (
            <div className="notice notice-error" role="alert">
              <Icon name="alert" />
              <span>
                Storage is unavailable. New analyses and experiments are paused
                because their evidence cannot be saved. Existing records remain
                available for inspection.
              </span>
            </div>
          )}
          {loading ? (
            <div className="loading-panel">
              <div className="loader" />
              <h2>Reading the change</h2>
              <p>Loading your local workspace and tracing dependencies.</p>
            </div>
          ) : (
            <>
              {page === "impact" && (
                <>
                  <form className="repository-panel" onSubmit={analyze}>
                    <div className="panel-heading">
                      <div className="heading-inline">
                        <Icon name="folder" />
                        <h2>Compare revisions</h2>
                        <span className="badge badge-neutral">
                          {analysis?.experimentEligible
                            ? "BUNDLED FIXTURE"
                            : "LOCAL REPOSITORY"}
                        </span>
                      </div>
                      {demo && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => {
                            setInput({
                              repository: demo.repository,
                              baseRef: demo.baseRef,
                              headRef: demo.headRef,
                            });
                          }}
                        >
                          Use example project <Icon name="arrow" size={14} />
                        </button>
                      )}
                    </div>
                    <div className="repository-form">
                      <label className="repository-field">
                        <span>Repository path</span>
                        <div className="input-wrap">
                          <Icon name="folder" size={16} />
                          <input
                            required
                            value={input.repository}
                            onChange={(e) =>
                              setInput({ ...input, repository: e.target.value })
                            }
                            placeholder="Absolute path to a Git repository"
                            autoComplete="off"
                          />
                        </div>
                      </label>
                      <label>
                        <span>Base revision</span>
                        <div className="input-wrap">
                          <Icon name="branch" size={15} />
                          <input
                            required
                            value={input.baseRef}
                            onChange={(e) =>
                              setInput({ ...input, baseRef: e.target.value })
                            }
                            autoComplete="off"
                          />
                        </div>
                      </label>
                      <span className="compare-arrow">
                        <Icon name="arrow" size={18} />
                      </span>
                      <label>
                        <span>Compare with</span>
                        <div className="input-wrap">
                          <Icon name="branch" size={15} />
                          <input
                            required
                            value={input.headRef}
                            onChange={(e) =>
                              setInput({ ...input, headRef: e.target.value })
                            }
                            placeholder="Ref or WORKTREE"
                            autoComplete="off"
                          />
                        </div>
                      </label>
                      <button
                        type="submit"
                        className="button button-orange"
                        disabled={analyzing || storageUnavailable}
                      >
                        {analyzing ? (
                          <Icon name="refresh" className="spin" size={16} />
                        ) : (
                          <Icon name="graph" size={16} />
                        )}{" "}
                        {analyzing ? "Analyzing…" : "Analyze change"}
                      </button>
                    </div>
                    <p className="form-hint">
                      Read-only Git analysis · Use <code>WORKTREE</code> to
                      include uncommitted changes.
                      {analysis && (
                        <> Last analyzed {stamp(analysis.createdAt)}.</>
                      )}
                    </p>
                  </form>
                  {analysis ? (
                    <ImpactView
                      analysis={analysis}
                      selectedNode={selectedNode}
                      setSelectedNode={setSelectedNode}
                      selectedFile={selectedFile}
                      setSelectedFile={setSelectedFile}
                      onScenario={(s) => {
                        setScenario(s);
                        setPage("tunnel");
                      }}
                    />
                  ) : (
                    <Empty
                      icon="graph"
                      title="Your first investigation starts here"
                      detail="Choose a local Git repository and two revisions to inspect their dependencies."
                    />
                  )}
                  {analyses.length > 1 && (
                    <details className="analysis-history">
                      <summary>
                        Previous analyses <span>{analyses.length}</span>
                      </summary>
                      <div>
                        {analyses.map((a) => (
                          <button
                            key={a.id}
                            onClick={() => chooseAnalysis(a)}
                            className={a.id === analysis?.id ? "current" : ""}
                          >
                            <Icon name="branch" size={16} />
                            <strong>{a.repositoryName}</strong>
                            <span>
                              {a.baseRef} → {a.headRef}
                            </span>
                            <time>{stamp(a.createdAt)}</time>
                            <Icon name="chevron" size={14} />
                          </button>
                        ))}
                      </div>
                    </details>
                  )}
                </>
              )}
              {page === "tunnel" && (
                <>
                  <div className="experiment-context">
                    <span className="context-icon">
                      <Icon name="branch" size={21} />
                    </span>
                    <div>
                      <span className="small-label">ACTIVE COMPARISON</span>
                      <strong>
                        {analysis
                          ? analysis.repositoryName
                          : "No analysis selected"}
                      </strong>
                    </div>
                    {analysis && (
                      <div className="revision-pair">
                        <code>{analysis.baseRef}</code>
                        <Icon name="arrow" size={16} />
                        <code>{analysis.headRef}</code>
                      </div>
                    )}
                    <button
                      className="text-button"
                      onClick={() => setPage("impact")}
                    >
                      Change comparison <Icon name="chevron" size={14} />
                    </button>
                  </div>
                  <div className="section-heading">
                    <div>
                      <span className="step-number">01</span>
                      <h2>Choose a fault scenario</h2>
                    </div>
                    <span className="section-note">
                      Same workload. Same fault. Two revisions.
                    </span>
                  </div>
                  <div className="scenario-grid">
                    {SCENARIOS.map((s, index) => (
                      <button
                        key={s.id}
                        onClick={() => setScenario(s.id)}
                        aria-pressed={scenario === s.id}
                        className={`scenario-card ${scenario === s.id ? "chosen" : ""}`}
                      >
                        <div className="scenario-top">
                          <span className="scenario-icon">
                            <Icon
                              name={
                                (
                                  [
                                    "bolt",
                                    "clock",
                                    "close",
                                    "check",
                                  ] as IconName[]
                                )[index]
                              }
                              size={22}
                            />
                          </span>
                          <span className="radio-indicator">
                            {scenario === s.id && <span />}
                          </span>
                        </div>
                        <h3>{s.name}</h3>
                        <p>{s.description}</p>
                        <span className="scenario-footer">
                          {analysis?.recommendations.includes(s.id) ? (
                            <>
                              <span className="orange-dot" /> Suggested for this
                              change
                            </>
                          ) : index === 3 ? (
                            "Establish a baseline"
                          ) : (
                            "Controlled local fault"
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="tunnel-controls">
                    <div className="mechanism">
                      <span className="small-label">WHAT ACTUALLY HAPPENS</span>
                      <p>{currentScenario.mechanism}</p>
                    </div>
                    <label>
                      <span>Requests per revision</span>
                      <input
                        type="number"
                        min="5"
                        max="100"
                        step="1"
                        value={requests}
                        onChange={(e) => setRequests(e.target.value)}
                        aria-invalid={!validWorkload}
                      />
                      <small className="workload-hint">5–100 requests</small>
                    </label>
                    <button
                      className="button button-orange"
                      disabled={
                        !analysis?.experimentEligible ||
                        !!running ||
                        starting ||
                        !validWorkload ||
                        storageUnavailable
                      }
                      onClick={startRun}
                    >
                      <Icon
                        name={starting ? "refresh" : "play"}
                        className={starting ? "spin" : ""}
                        size={17}
                      />
                      {starting
                        ? "Starting…"
                        : running
                          ? "Experiment in progress"
                          : "Run experiment"}
                    </button>
                  </div>
                  {!analysis?.experimentEligible && (
                    <div className="notice">
                      <Icon name="alert" />
                      <span>
                        Execution is available for the bundled fixture
                        comparison. Other repositories support read-only impact
                        analysis.{" "}
                        <button
                          className="text-button"
                          onClick={() => setPage("impact")}
                        >
                          Return to analysis
                        </button>
                      </span>
                    </div>
                  )}
                  <div className="execution-note">
                    <Icon name="terminal" size={15} />
                    <span>
                      Real local HTTP services · Fresh baseline and candidate
                      processes · No production targets
                    </span>
                  </div>
                  {tunnelRun ? (
                    <RunView
                      run={tunnelRun}
                      analysis={analysis}
                      onCancel={cancelRun}
                    />
                  ) : (
                    <div className="ready-panel">
                      <span className="ready-symbol">
                        <Icon name="wind" size={36} />
                      </span>
                      <div>
                        <h2>Ready for a little turbulence.</h2>
                        <p>
                          Start an experiment to compare actual behavior,
                          inspect traces, and uncover broken invariants.
                        </p>
                      </div>
                      <span className="ready-index">02</span>
                    </div>
                  )}
                </>
              )}
              {page === "evidence" && (
                <>
                  {runs.length ? (
                    <div className="evidence-layout">
                      <section className="panel runs-list">
                        <div className="panel-heading">
                          <h2>Experiment history</h2>
                          <span className="badge badge-neutral">
                            {runs.length} RUNS
                          </span>
                        </div>
                        {runs.map((r) => (
                          <button
                            className={`run-list-item ${r.id === runId ? "chosen" : ""}`}
                            key={r.id}
                            onClick={() => setRunId(r.id)}
                          >
                            <span
                              className={`run-icon ${r.result?.verdict === "regression" ? "danger" : ""}`}
                            >
                              <Icon
                                name={
                                  active(r)
                                    ? "refresh"
                                    : r.result?.verdict === "regression"
                                      ? "alert"
                                      : "stack"
                                }
                                size={18}
                                className={active(r) ? "spin" : ""}
                              />
                            </span>
                            <span className="run-list-text">
                              <strong>
                                {
                                  SCENARIOS.find((s) => s.id === r.scenario)
                                    ?.name
                                }
                              </strong>
                              <span>
                                {stamp(r.createdAt)} · {r.requests} requests /
                                revision
                              </span>
                            </span>
                            <Status run={r} />
                            <Icon name="chevron" size={14} />
                          </button>
                        ))}
                      </section>
                      <div>
                        {run ? (
                          <RunView
                            run={run}
                            analysis={
                              analyses.find((a) => a.id === run.analysisId) ||
                              null
                            }
                            onCancel={cancelRun}
                          />
                        ) : (
                          <Empty
                            icon="stack"
                            title="Select an experiment"
                            detail="Choose a run to inspect its measurements and traces."
                          />
                        )}
                      </div>
                    </div>
                  ) : (
                    <Empty
                      icon="stack"
                      title="Evidence is earned, not estimated"
                      detail="Run your first controlled experiment to get measured comparisons, invariant checks, and request traces."
                      action={
                        <button
                          className="button button-dark"
                          onClick={() => setPage("tunnel")}
                        >
                          Open wind tunnel <Icon name="arrow" size={16} />
                        </button>
                      }
                    />
                  )}
                </>
              )}
              {page === "architecture" && <Architecture />}
            </>
          )}
          <footer className="page-footer">
            <span>
              FAULTLINE <span className="footer-slash">/</span> CHANGE UNDER
              PRESSURE
            </span>
            <span>Predictions guide. Experiments provide evidence.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}

function Empty({
  icon,
  title,
  detail,
  action,
}: {
  icon: IconName;
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-panel">
      <span className="empty-icon">
        <Icon name={icon} size={30} />
      </span>
      <h2>{title}</h2>
      <p>{detail}</p>
      {action}
    </div>
  );
}

function ImpactView({
  analysis: a,
  selectedNode,
  setSelectedNode,
  selectedFile,
  setSelectedFile,
  onScenario,
}: {
  analysis: AnalysisResult;
  selectedNode: string | null;
  setSelectedNode: (id: string) => void;
  selectedFile: string | null;
  setSelectedFile: (id: string) => void;
  onScenario: (id: ScenarioId) => void;
}) {
  const node = a.graph.nodes.find((n) => n.id === selectedNode);
  const impact = a.impacts.find((i) => i.path === node?.path);
  const file = a.changes.find((f) => f.path === selectedFile) || a.changes[0];
  const impacted = a.graph.nodes.filter((n) => n.status === "impacted").length;
  const stats = [
    {
      label: "Changed files",
      value: a.summary.filesChanged,
      icon: "code" as IconName,
      note: `${a.summary.symbolsChanged} changed symbols`,
      tone: "orange",
    },
    {
      label: "Affected dependents",
      value: a.summary.impactedFiles,
      icon: "graph" as IconName,
      note: "Reverse dependency traversal",
      tone: "blue",
    },
    {
      label: "Files in graph",
      value: a.summary.totalFiles,
      icon: "layers" as IconName,
      note: "Supported source files analyzed",
      tone: "neutral",
    },
  ];
  return (
    <>
      <div className="stats-grid">
        {stats.map((s) => (
          <div className={`stat-card ${s.tone}`} key={s.label}>
            <div className="stat-top">
              <span>{s.label}</span>
              <Icon name={s.icon} size={18} />
            </div>
            <div className="stat-value">
              {s.value.toString().padStart(2, "0")}
              <span>
                {s.label === "Changed files"
                  ? "Δ"
                  : s.label === "Affected dependents"
                    ? "↗"
                    : "⌘"}
              </span>
            </div>
            <div className="stat-note">{s.note}</div>
          </div>
        ))}
      </div>
      <div className="impact-layout">
        <section className="panel graph-panel">
          <div className="panel-heading">
            <div className="heading-inline">
              <h2>Dependency map</h2>
              <span className="badge badge-neutral">STATIC ANALYSIS</span>
            </div>
            <span className="graph-count">
              {a.graph.nodes.length} nodes / {a.graph.edges.length} edges
            </span>
          </div>
          <Topology
            nodes={a.graph.nodes}
            edges={a.graph.edges}
            selected={selectedNode}
            onSelect={setSelectedNode}
          />
          <div className="graph-legend">
            <span>
              <i className="legend-dot changed" />
              Changed
            </span>
            <span>
              <i className="legend-dot impacted" />
              Affected dependent ({impacted})
            </span>
            <span>
              <i className="legend-dot" />
              Unchanged
            </span>
            <span className="legend-hint">Select a node to inspect</span>
          </div>
        </section>
        <aside className="panel inspection-panel">
          <div className="panel-heading">
            <h2>Follow the impact</h2>
            <Icon name="graph" size={17} />
          </div>
          {node ? (
            <div className="inspection-body">
              <span
                className={`badge badge-${node.status === "changed" ? "orange" : node.status === "impacted" ? "blue" : "neutral"}`}
              >
                {node.status === "impacted"
                  ? "AFFECTED DEPENDENT"
                  : node.status.toUpperCase()}
              </span>
              <h3>{node.label}</h3>
              <code className="path-label">{node.path}</code>
              <p>
                {impact?.reason ||
                  (node.status === "changed"
                    ? "This file changed between the selected revisions. Its dependents may observe different behavior."
                    : "No reverse dependency path from a changed file was identified in the supported graph.")}
              </p>
              {impact && (
                <div className="dependency-chain">
                  <span className="small-label">DEPENDENCY PATH</span>
                  {impact.chain.map((path, index) => (
                    <div key={`${path}-${index}`}>
                      <span
                        className={`chain-dot ${index === 0 ? "orange-dot" : ""}`}
                      />
                      <code title={path}>{basename(path)}</code>
                      {index === 0 && (
                        <span className="chain-label">changed</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {node.symbols.length > 0 && (
                <div className="symbol-list">
                  <span className="small-label">SYMBOLS</span>
                  <div>
                    {node.symbols.map((s, i) => (
                      <code key={`${s}-${i}`}>{s}</code>
                    ))}
                  </div>
                </div>
              )}
              <div className="prediction-note">
                <Icon name="alert" size={15} />
                <span>
                  Dependency reach is a prediction, not proof of a runtime
                  failure.
                </span>
              </div>
            </div>
          ) : (
            <p className="inspection-body">
              No supported source files in this comparison.
            </p>
          )}
        </aside>
      </div>
      <div className="section-heading">
        <div>
          <span className="step-number">Δ</span>
          <h2>Inside the change</h2>
        </div>
        <span className="section-note mono">
          {short(a.baseCommit)} <span className="muted">→</span>{" "}
          {short(a.headCommit)}
        </span>
      </div>
      <section className="panel diff-panel">
        <div className="changed-files">
          <div className="file-list-label">
            CHANGED FILES <span>{a.changes.length}</span>
          </div>
          {a.changes.map((f) => (
            <button
              key={f.path}
              onClick={() => setSelectedFile(f.path)}
              className={f.path === file?.path ? "chosen" : ""}
            >
              <Icon name="code" size={15} />
              <span title={f.path}>
                {basename(f.path)}
                <small>
                  {f.path.includes("/")
                    ? f.path.slice(0, f.path.lastIndexOf("/"))
                    : f.status}
                </small>
              </span>
              <span className="file-change-count">
                <em>+{f.additions}</em>
                <b>−{f.deletions}</b>
              </span>
            </button>
          ))}
          {!a.changes.length && <p className="no-change">No file changes.</p>}
        </div>
        <div className="source-diff">
          {file ? (
            <>
              <div className="diff-file-heading">
                <code>{file.path}</code>
                <span className="badge badge-neutral">{file.status}</span>
              </div>
              <pre tabIndex={0} aria-label={`Diff for ${file.path}`}>
                {file.patch ? (
                  file.patch.split("\n").map((line, i) => (
                    <div
                      className={
                        line.startsWith("+++") || line.startsWith("---")
                          ? "diff-meta"
                          : line.startsWith("+")
                            ? "diff-added"
                            : line.startsWith("-")
                              ? "diff-deleted"
                              : line.startsWith("@@")
                                ? "diff-hunk"
                                : "diff-line"
                      }
                      key={i}
                    >
                      <span className="diff-line-no" aria-hidden="true">
                        {i + 1}
                      </span>
                      <span>{line || " "}</span>
                    </div>
                  ))
                ) : (
                  <div className="diff-line">
                    <span>Diff content is not available for this file.</span>
                  </div>
                )}
              </pre>
            </>
          ) : (
            <div className="diff-empty">
              The selected revisions have no differences.
            </div>
          )}
        </div>
      </section>
      <div className="bottom-grid">
        <section className="panel suggestions-panel">
          <div className="panel-heading">
            <div className="heading-inline">
              <span className="orange">
                <Icon name="wind" />
              </span>
              <h2>Take the next step</h2>
            </div>
            <span className="badge badge-orange">EXPERIMENTS</span>
          </div>
          <p>Challenge this change with a controlled failure.</p>
          {a.recommendations.length ? (
            a.recommendations.map((id) => {
              const s = SCENARIOS.find((s) => s.id === id)!;
              return (
                <button
                  key={id}
                  className="suggestion"
                  onClick={() => onScenario(id)}
                >
                  <span>
                    <strong>{s.name}</strong>
                    <small>{s.description}</small>
                  </span>
                  <Icon name="arrow" size={18} />
                </button>
              );
            })
          ) : (
            <button
              className="suggestion"
              onClick={() => onScenario("healthy")}
            >
              <span>
                <strong>Establish a healthy control</strong>
                <small>Compare behavior without injecting a fault.</small>
              </span>
              <Icon name="arrow" />
            </button>
          )}
        </section>
        <section className="panel boundaries-panel">
          <div className="panel-heading">
            <div className="heading-inline">
              <Icon name="alert" size={17} />
              <h2>Know the boundaries</h2>
            </div>
            <span className="badge badge-neutral">ANALYSIS NOTES</span>
          </div>
          <ul>
            {a.warnings.length ? (
              a.warnings.map((w, i) => <li key={i}>{w}</li>)
            ) : (
              <li>
                Static analysis identifies dependency paths; runtime behavior
                must be checked with an experiment.
              </li>
            )}
          </ul>
        </section>
      </div>
    </>
  );
}

function Topology({
  nodes,
  edges,
  selected,
  onSelect,
}: {
  nodes: GraphNode[];
  edges: AnalysisResult["graph"]["edges"];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const cols = nodes.length <= 2 ? Math.max(nodes.length, 1) : 3;
  const rows = Math.max(Math.ceil(nodes.length / cols), 1);
  const width = 850,
    height = Math.max(300, rows * 110 + 50),
    nodeWidth = 210,
    nodeHeight = 65;
  const positions = new Map(
    nodes.map((n, i) => [
      n.id,
      {
        x:
          (width - cols * nodeWidth) / (cols + 1) +
          (i % cols) * (nodeWidth + (width - cols * nodeWidth) / (cols + 1)),
        y: 45 + Math.floor(i / cols) * 110,
      },
    ]),
  );
  return (
    <div className="graph-canvas">
      {!nodes.length ? (
        <div className="graph-empty">No supported nodes were found.</div>
      ) : (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="group"
          aria-label="Source dependency graph"
        >
          <defs>
            <marker
              id="arrow"
              markerWidth="7"
              markerHeight="7"
              refX="6"
              refY="3.5"
              orient="auto"
            >
              <path d="m0 0 7 3.5L0 7" fill="#b7bfc3" />
            </marker>
            <marker
              id="arrow-active"
              markerWidth="7"
              markerHeight="7"
              refX="6"
              refY="3.5"
              orient="auto"
            >
              <path d="m0 0 7 3.5L0 7" fill="#ee633d" />
            </marker>
          </defs>
          {edges.map((edge, index) => {
            const from = positions.get(edge.source),
              to = positions.get(edge.target);
            if (!from || !to) return null;
            const sameRow = from.y === to.y;
            const direction = to.x > from.x ? 1 : -1;
            const x1 = sameRow
              ? from.x + (direction === 1 ? nodeWidth : 0)
              : from.x + nodeWidth / 2;
            const x2 = sameRow
              ? to.x + (direction === 1 ? 0 : nodeWidth)
              : to.x + nodeWidth / 2;
            const y1 = sameRow
              ? from.y + nodeHeight / 2
              : from.y + (to.y > from.y ? nodeHeight : 0);
            const y2 = sameRow
              ? to.y + nodeHeight / 2
              : to.y + (to.y > from.y ? 0 : nodeHeight);
            const connected =
              edge.source === selected || edge.target === selected;
            const d = sameRow
              ? `M${x1},${y1} C${x1 + direction * 25},${y1} ${x2 - direction * 25},${y2} ${x2},${y2}`
              : `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`;
            return (
              <path
                key={index}
                d={d}
                fill="none"
                stroke={connected ? "#ee633d" : "#bec6c8"}
                strokeWidth={connected ? 2 : 1.4}
                strokeDasharray={edge.kind === "call" ? "5 4" : undefined}
                markerEnd={`url(#${connected ? "arrow-active" : "arrow"})`}
              />
            );
          })}
          {nodes.map((n) => {
            const p = positions.get(n.id)!;
            const chosen = selected === n.id;
            const color =
              n.status === "changed"
                ? "#e46a42"
                : n.status === "impacted"
                  ? "#527aa6"
                  : "#b4bbb9";
            return (
              <g
                className={`graph-node ${chosen ? "selected" : ""}`}
                key={n.id}
                transform={`translate(${p.x} ${p.y})`}
                role="button"
                tabIndex={0}
                aria-label={`${n.path}, ${n.status}`}
                aria-pressed={chosen}
                onClick={() => onSelect(n.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(n.id);
                  }
                }}
              >
                <title>{n.path}</title>
                <rect
                  className="node-shadow"
                  x="0"
                  y="3"
                  width={nodeWidth}
                  height={nodeHeight}
                  rx="7"
                />
                <rect
                  width={nodeWidth}
                  height={nodeHeight}
                  rx="7"
                  fill={chosen ? "#fffaf6" : "#fff"}
                  stroke={chosen ? "#e46a42" : "#d9ddda"}
                  strokeWidth={chosen ? 1.7 : 1}
                />
                <rect
                  x="0"
                  y="12"
                  width="3"
                  height="41"
                  rx="1.5"
                  fill={color}
                />
                <text x="16" y="23" className="node-service">
                  {n.service.toUpperCase().slice(0, 26)}
                </text>
                <text x="16" y="45" className="node-label">
                  {n.label.length > 25 ? n.label.slice(0, 23) + "…" : n.label}
                </text>
                <circle cx="193" cy="19" r="3.5" fill={color} />
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

function Status({ run }: { run: ExperimentRun }) {
  const text =
    run.result?.verdict === "regression"
      ? "Regression"
      : run.result?.verdict === "no-regression"
        ? "No regression"
        : label(run.status);
  return (
    <span
      className={`status-badge status-${run.result?.verdict || run.status}`}
    >
      <span />
      {text}
    </span>
  );
}
function RunView({
  run,
  analysis,
  onCancel,
}: {
  run: ExperimentRun;
  analysis: AnalysisResult | null;
  onCancel: (run: ExperimentRun) => void;
}) {
  const [traceVariant, setTraceVariant] = useState<"baseline" | "candidate">(
    "candidate",
  );
  const result = run.result;
  const traces = result?.[traceVariant].traces || [];
  return (
    <section className="run-detail">
      <div className="section-heading">
        <div>
          <span className="step-number">
            {active(run) ? (
              <Icon name="refresh" className="spin" size={15} />
            ) : (
              "↳"
            )}
          </span>
          <h2>
            {active(run) ? "Experiment in progress" : "Experiment evidence"}
          </h2>
          <Status run={run} />
        </div>
        <div className="run-actions">
          {active(run) && (
            <button
              className="button button-quiet button-small"
              onClick={() => onCancel(run)}
            >
              <Icon name="stop" size={13} />
              Cancel
            </button>
          )}
          <a
            className="button button-quiet button-small"
            href={`/api/runs/${run.id}/export`}
            download
          >
            <Icon name="download" size={14} />
            Export JSON
          </a>
        </div>
      </div>
      <div className="run-meta">
        <span>
          <Icon name="wind" size={13} />
          {SCENARIOS.find((s) => s.id === run.scenario)?.name}
        </span>
        <span>{run.requests} requests per revision</span>
        <code title={run.id}>RUN {run.id.slice(0, 8)}</code>
        <span>{stamp(run.createdAt)}</span>
      </div>
      <div className="run-source">
        <Icon name="branch" size={14} />
        <strong>{analysis?.repositoryName || "Recorded analysis"}</strong>
        {analysis ? (
          <>
            <code title={analysis.baseCommit}>
              {analysis.baseRef} @ {analysis.baseCommit.slice(0, 12)}
            </code>
            <Icon name="arrow" size={13} />
            <code title={analysis.headCommit}>
              {analysis.headRef} @ {analysis.headCommit.slice(0, 12)}
            </code>
            <details className="commit-details">
              <summary>Full revision IDs</summary>
              <span>
                Baseline <code>{analysis.baseCommit}</code>
              </span>
              <span>
                Candidate <code>{analysis.headCommit}</code>
              </span>
            </details>
          </>
        ) : (
          <code>{run.analysisId}</code>
        )}
      </div>
      {run.error && (
        <div className="notice notice-error">
          <Icon name="alert" />
          <span>{run.error}</span>
        </div>
      )}
      {active(run) && (
        <div className="progress-panel" role="status" aria-live="polite">
          <div className="progress-top">
            <strong>
              {run.events.at(-1)?.message ||
                "Preparing local service processes…"}
            </strong>
            <span className="badge badge-orange">
              {run.events.at(-1)?.phase || run.status}
            </span>
          </div>
          <div className="indeterminate-progress">
            <span />
          </div>
          <p>
            Measurements appear when both revision workloads finish. You can
            leave this view while the runner works.
          </p>
        </div>
      )}
      {!result && !active(run) && (
        <div className="notice">
          <Icon name="alert" />
          <span>
            This experiment {label(run.status)}. No complete baseline–candidate
            comparison is available. Inspect the execution log below.
          </span>
        </div>
      )}
      {result && (
        <>
          <div className={`verdict-banner verdict-${result.verdict}`}>
            <span className="verdict-icon">
              <Icon
                name={
                  result.verdict === "regression"
                    ? "alert"
                    : result.verdict === "no-regression"
                      ? "check"
                      : "alert"
                }
                size={24}
              />
            </span>
            <div>
              <span className="small-label">EXPERIMENT VERDICT</span>
              <h3>
                {result.verdict === "regression"
                  ? "A regression surfaced."
                  : result.verdict === "no-regression"
                    ? "No regression observed."
                    : "The evidence is inconclusive."}
              </h3>
              <p>
                {result.verdict === "regression"
                  ? "The candidate broke a checked invariant or worsened the measured outcome."
                  : result.verdict === "no-regression"
                    ? "The candidate passed the checked invariants for this workload and fault scenario."
                    : "This run does not support a reliable conclusion. Inspect findings before proceeding."}
              </p>
            </div>
            <span className="verdict-watermark">
              <Icon name="wind" size={75} />
            </span>
          </div>
          <div className="comparison-grid">
            <Metric
              title="Duplicate charges"
              field="duplicateCharges"
              result={result}
              format={String}
              critical
            />
            <Metric
              title="Request errors"
              field="errorRate"
              result={result}
              format={(v) => `${(v * 100).toFixed(1)}%`}
            />
            <Metric
              title="p95 response time"
              field="p95Ms"
              result={result}
              format={formatMs}
            />
          </div>
          <div className="result-grid">
            <section className="panel findings-panel">
              <div className="panel-heading">
                <h2>Invariant findings</h2>
                <span className="badge badge-neutral">
                  {result.findings.length} CHECKS
                </span>
              </div>
              <div className="findings-body">
                {result.findings.length ? (
                  result.findings.map((f, i) => (
                    <div className={`finding finding-${f.severity}`} key={i}>
                      <span className="finding-icon">
                        <Icon
                          name={f.severity === "info" ? "check" : "alert"}
                          size={16}
                        />
                      </span>
                      <div>
                        <div className="finding-title">
                          <h3>{f.title}</h3>
                          <span>{f.severity}</span>
                        </div>
                        <p>{f.detail}</p>
                        {f.evidence.length > 0 && (
                          <details>
                            <summary>Supporting evidence</summary>
                            <ul>
                              {f.evidence.map((e, index) => (
                                <li key={index}>{e}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p>No invariant findings were recorded.</p>
                )}
              </div>
            </section>
            <section className="panel workload-panel">
              <div className="panel-heading">
                <h2>Measured workload</h2>
                <Icon name="terminal" size={16} />
              </div>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Measurement</th>
                    <th scope="col">Base</th>
                    <th scope="col">Candidate</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["Successful requests", "successes"],
                      ["Failed requests", "failures"],
                      ["Recorded charges", "totalCharges"],
                      ["Inventory reservations", "inventoryReservations"],
                      ["Median latency", "p50Ms"],
                      ["Workload duration", "durationMs"],
                    ] as const
                  ).map(([name, key]) => (
                    <tr key={key}>
                      <th scope="row">{name}</th>
                      <td>
                        {key.endsWith("Ms")
                          ? formatMs(result.baseline[key])
                          : result.baseline[key]}
                      </td>
                      <td>
                        {key.endsWith("Ms")
                          ? formatMs(result.candidate[key])
                          : result.candidate[key]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
          <section className="panel traces-panel">
            <div className="panel-heading">
              <div className="heading-inline">
                <h2>Request traces</h2>
                <span className="badge badge-neutral">
                  {traces.length} SPANS
                </span>
              </div>
              <div className="segmented-control" aria-label="Trace revision">
                {(["baseline", "candidate"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setTraceVariant(v)}
                    aria-pressed={traceVariant === v}
                    className={traceVariant === v ? "selected" : ""}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div className="table-scroll">
              <table className="trace-table">
                <thead>
                  <tr>
                    <th scope="col">Request</th>
                    <th scope="col">Service / operation</th>
                    <th scope="col">Outcome</th>
                    <th scope="col">Duration</th>
                    <th scope="col">Observed detail</th>
                  </tr>
                </thead>
                <tbody>
                  {traces.map((t, i) => (
                    <tr key={`${t.requestId}-${i}`}>
                      <td>
                        <code>{t.requestId}</code>
                      </td>
                      <td>
                        <strong>{t.service}</strong>
                        <span className="trace-operation">{t.operation}</span>
                      </td>
                      <td>
                        <span className={`trace-status ${t.status}`}>
                          {t.status}
                        </span>
                      </td>
                      <td className="mono">{formatMs(t.durationMs)}</td>
                      <td>{t.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!traces.length && (
                <p className="table-empty">
                  No spans were recorded for this revision.
                </p>
              )}
            </div>
          </section>
          <div className="environment-note">
            <Icon name="terminal" size={16} />
            <div>
              <strong>{result.environment.kind} execution</strong>
              <p>
                {result.environment.isolation}{" "}
                {result.environment.faultMechanism}
              </p>
            </div>
          </div>
        </>
      )}
      <details className="panel execution-log" open={active(run)}>
        <summary>
          <span>
            <Icon name="terminal" size={16} />
            Execution log{" "}
            <span className="badge badge-neutral">
              {run.events.length} EVENTS
            </span>
          </span>
          <Icon name="chevron" size={15} />
        </summary>
        <div className="log-body">
          {run.events.length ? (
            run.events.map((event, i) => (
              <div key={i}>
                <time>
                  {new Date(event.time).toLocaleTimeString(undefined, {
                    hour12: false,
                  })}
                </time>
                <span className="log-phase">{event.phase}</span>
                <span>{event.message}</span>
              </div>
            ))
          ) : (
            <p>Waiting for the runner to record its first event.</p>
          )}
        </div>
      </details>
    </section>
  );
}
function Metric({
  title,
  field,
  result,
  format,
  critical,
}: {
  title: string;
  field: "duplicateCharges" | "errorRate" | "p95Ms";
  result: NonNullable<ExperimentRun["result"]>;
  format: (n: number) => string;
  critical?: boolean;
}) {
  const base = result.baseline[field],
    candidate = result.candidate[field],
    worse = candidate > base;
  return (
    <div className={`metric-card ${worse && critical ? "metric-danger" : ""}`}>
      <span className="metric-title">{title}</span>
      <div className="metric-comparison">
        <div>
          <span>BASELINE</span>
          <strong>{format(base)}</strong>
        </div>
        <Icon name="arrow" size={18} />
        <div>
          <span>CANDIDATE</span>
          <strong className={worse ? "regressed" : ""}>
            {format(candidate)}
          </strong>
        </div>
      </div>
      <div className="metric-foot">
        {field === "duplicateCharges"
          ? "Invariant: one charge per order"
          : field === "errorRate"
            ? "Failed HTTP requests / total requests"
            : "95th percentile of observed response times"}
      </div>
    </div>
  );
}

function Architecture() {
  const modules: [string, IconName, string, string][] = [
    [
      "01",
      "branch",
      "Analyze",
      "Git revisions → TypeScript syntax trees → local dependency graph. Resolve supported imports, locate changed symbols, traverse reverse dependencies.",
    ],
    [
      "02",
      "wind",
      "Experiment",
      "Use the fixture’s pinned revisions. Start fresh service processes, run the same workload, apply a defined payment fault, collect outcomes, and stop the processes.",
    ],
    [
      "03",
      "stack",
      "Explain",
      "Compare request errors and latency, check business invariants, and preserve findings alongside concrete traces and lifecycle events.",
    ],
  ];
  return (
    <>
      <div className="architecture-intro">
        <span className="badge badge-orange">SYSTEM CONTRACT</span>
        <h2>
          Code tells us where to look.
          <br />
          Execution tells us what happened.
        </h2>
        <p>
          Faultline combines a read-only code investigation with a controlled
          local experiment. The link between them stays explicit, inspectable,
          and bounded.
        </p>
      </div>
      <section className="panel architecture-map">
        <div className="panel-heading">
          <h2>From revision to evidence</h2>
          <span className="badge badge-neutral">LOCAL EXECUTION</span>
        </div>
        <div className="architecture-flow">
          <div>
            <span className="architecture-node-icon">
              <Icon name="code" size={24} />
            </span>
            <strong>React workspace</strong>
            <small>Review & control</small>
          </div>
          <Icon name="arrow" size={23} />
          <div>
            <span className="architecture-node-icon">
              <Icon name="terminal" size={24} />
            </span>
            <strong>Node control API</strong>
            <small>Validate & persist</small>
          </div>
          <Icon name="arrow" size={23} />
          <div>
            <span className="architecture-node-icon accent">
              <Icon name="wind" size={24} />
            </span>
            <strong>Experiment runner</strong>
            <small>Baseline → candidate</small>
          </div>
          <Icon name="arrow" size={23} />
          <div>
            <span className="architecture-node-icon">
              <Icon name="stack" size={24} />
            </span>
            <strong>Evidence report</strong>
            <small>Metrics, traces & findings</small>
          </div>
        </div>
        <div className="architecture-foundation">
          <span>
            <Icon name="branch" size={16} />
            Local Git checkout
          </span>
          <span>
            <Icon name="graph" size={16} />
            TypeScript compiler analysis
          </span>
          <span>
            <Icon name="layers" size={16} />
            Isolated HTTP service processes
          </span>
        </div>
      </section>
      <div className="architecture-modules">
        {modules.map(([number, icon, title, description]) => (
          <section className="panel" key={number}>
            <div className="architecture-module-top">
              <span>{number}</span>
              <Icon name={icon} size={22} />
            </div>
            <h3>{title}</h3>
            <p>{description}</p>
          </section>
        ))}
      </div>
      <div className="bottom-grid">
        <section className="panel architecture-contract">
          <div className="panel-heading">
            <h2>What the system guarantees</h2>
            <Icon name="check" size={18} />
          </div>
          <ul>
            <li>
              Repository investigation uses read-only Git and source analysis.
            </li>
            <li>
              Fault experiments execute only against the bundled, recognized
              fixture revisions.
            </li>
            <li>
              Reports distinguish dependency predictions from measured runtime
              outcomes.
            </li>
            <li>
              Cancelled or incomplete runs do not receive a complete comparison
              verdict.
            </li>
            <li>JSON exports preserve the recorded run evidence for review.</li>
          </ul>
        </section>
        <section className="panel architecture-contract">
          <div className="panel-heading">
            <h2>What the evidence cannot prove</h2>
            <Icon name="alert" size={18} />
          </div>
          <ul>
            <li>
              Static analysis does not resolve every dynamic call or runtime
              dependency.
            </li>
            <li>
              Local processes do not reproduce all production network or
              infrastructure behavior.
            </li>
            <li>
              A passing experiment covers its specific workload, invariants, and
              fault schedule.
            </li>
            <li>
              Latency measurements depend on the current machine and require
              repeated trials for performance conclusions.
            </li>
            <li>
              Importing arbitrary repositories for execution requires a stronger
              sandbox and explicit execution policy.
            </li>
          </ul>
        </section>
      </div>
      <div className="architecture-principle">
        <Icon name="bolt" size={29} />
        <p>
          Every arrow in the graph is explainable.
          <br />
          <strong>Every verdict should be traceable.</strong>
        </p>
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
