# Status

Initial baseline: 2026-10-24, Windows, Node 22.21.1. Current project runtime: Node 22.23.4 (verified portable installation). Source location: `D:\Gpt projs\Faultline`.

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

## Security remediation — 2026-10-24

The first-release verification above is historical. The following evidence applies to this remediation increment:

| State | Item | Acceptance / evidence |
| --- | --- | --- |
| [x] Verified Complete | Patched runtime for project commands (G01) | Official Node 22.23.4 installed under ignored `.faultline/runtime/`; installer checked official SHA256, valid OpenJS Foundation Authenticode signature and actual version. `npm run runtime:check` returns v22.23.4. All project scripts select a supported runtime or fail closed. Machine-wide Node 22.21.1 and PATH are unchanged. |
| [x] Verified Complete | Offline object reads (S01 guard) | R01; shared Git invocation disables lazy fetch. Disposable missing-promisor-blob test fails within budget, performs no fetch, and preserves configuration/index/HEAD/worktree. This is not full hostile-repository certification. |
| [x] Verified Complete | Authenticated fixture (H01) | R04/R10; per-experiment capability authenticates all fixture requests and state reads; foreign Host/Origin, absent/wrong capability and non-JSON mutation rejected. Malformed JSON response/evidence does not expose the token. Legitimate workloads still pass. |
| [x] Verified Complete | Canonical asset containment (H02) | R10; regular assets and SPA fallback work, junction escapes rejected with 403, including fallback index. |
| [x] Verified Complete | Preserve old evidence | R08; `.faultline/demo-v2` is created alongside the old fixture. Old comparisons derive read-only eligibility and exports still work. Existing five record files and legacy fixture HEAD were unchanged through actual production startup and new experiments. |
| [~] Deferred | Cross-account Windows ACL hardening | User confirmed single-user computer, no other local human accounts or expected file access. Windows group grants alone do not establish another account. Reassess if sharing/deployment changes. No ACL changes made. |

Verification environment: Windows, Git 2.51.2, project Node 22.23.4; existing dependency lockfile unchanged except root engine metadata.

- `npm test`: **32/32 pass**, no skipped tests, 33.665 seconds; analyzer 10, runner 11, runtime 4, API/storage 7.
- `npm run build`: strict TypeScript and Vite production build pass, 29 transformed modules.
- Repeated all 18 isolated main HTTP/Vite boundary checks; all pass. Separate synthetic junction check now returns 403 without outside content.
- Actual `npm start`: production page and health return 200. Current demo analysis accepts experiments. New 5-request/revision healthy run has 0 duplicate charges for both revisions; lost-acknowledgement run has baseline 0 and candidate 5, verdict regression. Both JSON exports parse with schemaVersion 1. This is real synthetic-fixture HTTP execution.
- Actual `npm run dev`: page and proxied health return 200. Process inventory confirms the coordinator and Vite use the patched portable executable. Ctrl+C in the Windows PTY stops the idle development session, leaving no project service processes or app listeners. Temporary verification servers were stopped.
- Console interruption during an active run, other operating systems and a broader hostile Git configuration assessment remain unverified. Previously blocked deeper analyzer probes were not retried. No production security claim is made.

## GitHub handoff — 2026-10-26

The user authorized a public source repository at `https://github.com/Nikhil-4404/faultline`. Source, bundled fixtures, tests, dependency lockfile and specifications are included. Generated builds, dependencies, `.faultline/` runtime/evidence data and environment files remain ignored.

Pre-push verification on Windows with project Node 22.23.4: `npm test` passed 32/32 with no skips (36.211 seconds); `npm run build` passed strict TypeScript and Vite compilation. A heuristic credential-pattern scan covered all 41 source files and all 38 existing history blobs with no matches; this is not a complete secrets certification. No application behavior changed during publication, and no hosted application deployment was performed.
