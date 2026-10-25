# Requirements and acceptance criteria

| ID | Requirement | Observable acceptance |
| --- | --- | --- |
| R01 | Read-only local Git analysis | Resolve base/head safely; accept tracked WORKTREE edits; reject invalid refs/repositories; never checkout/reset or execute repository code. All analyzer Git reads use `--no-lazy-fetch`; unavailable partial-clone objects fail analysis instead of fetching them. |
| R02 | Explainable static impact | Show actual changed paths/symbols and reverse import chains; preserve dependencies from deleted source; distinguish uncertainty from runtime evidence. |
| R03 | Bounded analysis | At most 600 tracked source files, 512 KiB/file and 12 MiB across revisions; 45-second read/patch budget checked between operations, 15-second Git subprocess timeouts, 12,000-character displayed patches; omitted coverage warns. Exclude symlinks and common sensitive/generated/dependency paths. |
| R04 | Pinned experiment inputs | Execute only verified current bundled source at the commits saved in the analysis. Recalculate eligibility from the current canonical reference repository and baseline/candidate refs when listing analyses and starting runs; historical eligibility flags do not authorize execution. Ref tampering must fail without executing it. |
| R05 | Real comparable experiments | Same order IDs, workload size and first-attempt fault rule for each revision; report actual request latency and ledger counts. Healthy control has no duplicates. |
| R06 | Correctness regression | Lost-acknowledgement fixture: baseline duplicate charges = 0, candidate duplicate charges > 0, report regression with supporting counts. |
| R07 | Run lifecycle | One active run, bounded 5–100 requests per revision; cancel and clean up child processes; restart converts unfinished saved runs to interrupted. |
| R08 | Evidence persistence | Save analyses, events and results using ordered atomic JSON replacement; history survives restart; downloadable JSON includes run and source analysis. A new reference version preserves old repositories, analysis files and exports; old analyses become read-only. Storage failure degrades the coordinator, blocks mutations and exposes a failed memory-only record when the final save fails. |
| R09 | Accessible dashboard | Keyboard-operable forms/actions, labeled controls, visible loading/error/empty states, usable narrow layouts; no fabricated default metrics. |
| R10 | Local trust boundary | Bind loopback, check Host/Origin, bound JSON request size, validate scenario and workload, reject execution on arbitrary repositories. Fixture services require an ephemeral per-experiment bearer token and validate Host/Origin and JSON mutations. Final asset realpaths, including SPA fallback, must remain inside the canonical build directory; junction/symlink escapes return 403. |

## Targets and limits
Single user and coordinator. A small source repository is the supported first-release workload; exact enforced analysis limits are defined in the analyzer and surfaced as warnings. Experiments use four concurrent reference orders and ephemeral loopback ports. Latency is descriptive and environment-dependent. No production SLO or unmeasured throughput target is claimed.

The user confirmed this is a single-user Windows computer with no other local human accounts. Cross-account filesystem access is conditional future hardening; Windows group names alone do not establish a reachable attacker. No ACL changes are required for this local scope. Reassess for shared or remote deployment.

## Data lifecycle
All runtime data lives in `.faultline/`, ignored by Git. The current authenticated reference is `.faultline/demo-v2`; the earlier `.faultline/demo` and its evidence are preserved. Source excerpts and local paths are sensitive: export intentionally includes them. No telemetry, external upload, automatic publication or user credentials are required. Fixture tokens exist only for a running experiment and are not saved in evidence. Portable runtime setup explicitly downloads Node from the official distribution site. History does not auto-delete; the UI/API rejects additions at 1,000 records per kind. Archive data manually with the server stopped.
