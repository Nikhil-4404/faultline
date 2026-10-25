# Flows and architecture

```mermaid
flowchart TD
  Dashboard[React dashboard] --> API[Loopback HTTP control API]
  API --> Analyzer[Git snapshots and TypeScript AST analysis]
  Analyzer --> Analysis[Explainable file impact and changed symbols]
  API --> History[(Atomic JSON evidence records)]
  Analysis --> Plan[User chooses a fault scenario]
  Plan --> Coordinator[Single active run coordinator]
  Coordinator --> Baseline[Verified baseline: three HTTP processes]
  Coordinator --> Candidate[Verified candidate: three HTTP processes]
  Baseline --> Evidence[Measured latencies, traces and ledgers]
  Candidate --> Evidence
  Evidence --> History
  History --> Dashboard
```

## Analyze
Load the bundled reference repository or enter an existing local repository path and two refs. The API validates input and resolves refs to commits. Analyzer Git commands disable lazy fetching; missing partial-clone objects fail the request without a fetch. `WORKTREE` means tracked current working content, not a reproducible commit snapshot, and is labeled accordingly. Analyze tracked source, compute changes, traverse reverse import relationships and show supported evidence. External repositories remain read-only.

## Experiment
Only an analysis of the current registered reference repository and baseline/candidate refs is eligible. Eligibility is derived when displaying history and rechecked when starting a run. Choose one scenario and 5–100 requests per revision. `queued → running → completed | failed | cancelled`; coordinator restart maps unfinished saved states to `interrupted`. A second active experiment is rejected. Cancellation is cooperative; final state follows cleanup.

The runner verifies fixed bundled source before spawning and generates a per-experiment capability token. It starts fresh checkout, inventory and payments services on ephemeral loopback ports for each revision. The runner and services authenticate every HTTP call; fixture Host/Origin and mutation content type checks run before handlers. First-attempt failures are keyed by order ID. Both revisions receive the same order IDs and fault rule. Failure or cancellation closes processes; failed/incomplete runs have no comparison verdict. The token is not persisted with evidence.

Startup creates or validates the authenticated `.faultline/demo-v2` reference while preserving the older `.faultline/demo` repository. Previous analyses and results remain readable and exportable. Starting a new experiment from an old reference returns 422 and asks the user to analyze the current reference; history is not rewritten.

## Retry ambiguity
Under lost acknowledgement or latency, payments may record a charge before checkout receives success. Baseline reuses the order idempotency key. The deliberately faulty candidate changes that key per retry. At-least-once requests can therefore create duplicate effects in the candidate. No exactly-once delivery is claimed.

## Evidence
Compare real outcome counts and latencies. Correctness regressions are based on ledger invariants, not inferred solely from timing. Trace entries and counts are exported alongside the original analysis. A passing scenario establishes behavior only for its inputs and environment.
