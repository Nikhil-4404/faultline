# Faultline

## Product intent
Faultline connects code-change impact analysis to controlled resilience experiments. Developers inspect what a change may affect, run a baseline and candidate under the same application-level fault scenario, and inspect measured outcomes with trace and ledger evidence.

Primary users: developers and CSE students studying change risk, debugging and distributed systems. Demand and differentiation have not been independently validated.

## First release
- Read-only analysis of a user-selected local Git repository with tracked JavaScript/TypeScript source.
- File dependency graph, changed symbols, explainable reverse-dependency paths, source patches and explicit analysis limits.
- A bundled, labeled checkout reference application with checkout, inventory and payment HTTP processes.
- Compare pinned baseline/candidate revisions under healthy control, lost acknowledgement, slow dependency and outage scenarios.
- Real request measurements, payment duplication invariant, service traces, cancellation, persistent run history and JSON evidence export.
- Local dashboard; no account or cloud service required.

## Success criteria
Tests verify transitive and deleted-file impact; the healthy fixture has no duplicate charges; acknowledgement loss reveals duplicates in the candidate and none in the baseline. Interrupted runs never appear as completed. Export preserves the analyzed revisions and experiment evidence.

## Boundaries
External repositories are analyzed, never executed. Experiment execution is restricted to the bundled verified fixture. Local processes are disposable, not security sandboxes. Fault injection occurs at application HTTP boundaries, not the operating system network layer. No claim of universal breakage prediction, causal proof, complete network topology inference, production readiness or performance certification.

## Later scope
User-authored experiment adapters with explicit trust controls; OS/container fault injection; richer cross-service trace correlation; additional language adapters. These are not first-release features.
