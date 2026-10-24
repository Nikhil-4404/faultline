# Status

Baseline: 2026-10-24, Windows, Node 22.21.1. Source location: `D:\Gpt projs\Faultline`.

Markers: `[ ] Planned`, `[-] Active`, `[i] Implemented — Verification Pending`, `[x] Verified Complete`, `[!] Blocked`, `[~] Deferred`.

| State | Item | Acceptance / evidence |
| --- | --- | --- |
| [x] Verified Complete | Git/AST impact analysis | R01–R03; 9 real disposable-Git tests pass. |
| [x] Verified Complete | Real reference HTTP experiments | R04–R07; 9 runner tests pass, including maximum workload, cancellation and coordinator-crash orphan cleanup. |
| [x] Verified Complete | API, persistence and restart recovery | R07, R08, R10; 6 API/storage tests pass, including storage failure and shutdown races. |
| [x] Verified Complete | Local dashboard workflows | R09; production build and desktop/narrow browser checks, graph selection, healthy/reset runs, cancellation, history and actual JSON download verified. |
| [~] Deferred | Arbitrary app execution, OS/container fault injection, cloud publishing | Outside bounded local release. |

## Decisions
The combined project was authorized after discussion of Impact Explorer and Wind Tunnel. User requested a complete useful implementation and explicitly invoked Ponytail. Local-only work stays in the requested D: project directory. The first version uses actual disposable HTTP processes because the Docker engine is unavailable; this is not container sandboxing. No trained model or AI provider is needed for explainable static graphs or measured experiments.

## Verification record
2026-10-24, Windows, Node 22.21.1, Git 2.51.2; applicable to the first-release source committed after this record. `package-lock.json` records dependencies.

- `npm test`: 24/24 pass, no skipped tests, 37.24 seconds in the final combined run after source formatting. Analyzer 9, runner 9, API/storage 6.
- `npm run build`: strict TypeScript checks and Vite production build pass (29 transformed modules). Browser assets are built from the final UI source.
- `npm run dev`: both servers start; Vite page and proxied `/api/health` return HTTP 200. Temporary verification servers are stopped after checks.
- `npm audit --omit=dev --json`: 0 reported runtime dependency vulnerabilities at the time checked. This is not a complete security assessment.
- Browser: desktop 1265×720 and narrow 390×844 viewport (375 CSS pixels content width with scrollbar); no page-wide horizontal overflow at narrow size. Graph and trace tables intentionally scroll inside their panels. Graph selection displays the matching reverse dependency chain. Actual JSON link downloaded and parsed with schemaVersion 1 and pinned commit identities.
- Real browser experiment, 12 requests/revision: healthy control completes 12/12 per revision, 12 charges each, 0 duplicates each. Lost acknowledgement completes 12/12 per revision but baseline has 12 charges/0 duplicates and candidate has 24 charges/12 duplicates; verdict regression. These are actual fixture measurements, not seeded dashboard values.
- Browser cancellation: 100-request slow-dependency run cancelled, no completed comparison. Restart preserved the completed healthy/regression runs and cancelled run.
- Runner maximum-workload test: 100 requests/revision, slow dependency, approximately 12 seconds. Process inventory after tests and browser runs found no remaining fixture-service Node processes.
- Docker engine check failed with missing Docker Desktop Linux named pipe; no Docker experiment or container isolation claim.

## Remaining limits
This is a complete bounded local release, not a production-ready hosted platform. Static analysis resolves relative source imports, not tsconfig aliases or arbitrary runtime calls. WORKTREE is not an atomic snapshot. File/byte/time limits can reduce coverage and warn. Experiments support the verified bundled reference application only; OS-level faults, arbitrary repository execution, remote authentication, cloud deployment, other operating systems and full assistive-technology auditing were not verified.
