# Faultline

**See what changed. Test how it fails. Keep the evidence.**

A local code-impact explorer paired with a real HTTP resilience lab. Analyze a Git comparison, inspect reverse dependency paths, then compare a reference application's baseline and candidate under controlled failures.

## Run
Requires Node.js 22.13+ and Git.

```powershell
cd 'D:\Gpt projs\Faultline'
npm ci
npm run build
npm start
```

Open http://127.0.0.1:4317. Development: `npm run dev`, then http://127.0.0.1:5173.

## Try the complete workflow
1. Open the bundled checkout comparison in Impact Explorer. Its Git fixture is created locally on first startup.
2. Inspect the payment client's changed idempotency key, changed symbols and reverse import paths.
3. Open Wind Tunnel and run **Healthy control**. Both revisions should avoid duplicate charges.
4. Run **Lost acknowledgement**. The first charge is committed before its response is dropped. The baseline retry reuses the same key; the candidate incorrectly changes it and duplicates the charge.
5. Inspect measured traces and ledger evidence, open run history and export the JSON report.

Other local Git repositories support read-only JavaScript/TypeScript analysis. Use a commit/tag/branch for each side, or `WORKTREE` for tracked current edits. Experiments intentionally execute only verified bundled source, not arbitrary imported repository code.

## Checks
```powershell
npm run check
npm test
npm run build
```

## What the lab establishes
The reference workload executes real HTTP requests between fresh Node processes. Faults are injected at HTTP application boundaries; this is not OS network chaos or a security sandbox. Reports distinguish static predictions from runtime observations. Latency varies by machine; passing one scenario does not establish universal reliability.

Data persists in ignored `.faultline/`. JSON exports include local paths and source excerpts. Do not share them without reviewing their contents. The app binds loopback and has no remote authentication; do not expose it as a public server.

## Project specifications
Product: `prd.md`. Acceptance: `requirements.md`. Stack: `techstack.md`. Architecture/lifecycle: `flow.md`. API: `backend.md`. UI: `frontend.md`. Verification and deferred work: `status.md`.
