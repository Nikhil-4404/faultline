# Technology choices

- Supported runtime: Node.js `>=22.23.4 <23`; initial development used Windows Node 22.21.1 and Git 2.51.2. Current installation and verification evidence belongs in `status.md`.
- TypeScript with strict checks, native Node HTTP server and child processes. `tsx` runs backend and development scripts.
- TypeScript compiler API for source parsing; Git via argument arrays without a command shell. The analyzer disables implicit object fetching with `--no-lazy-fetch` in its shared Git execution path.
- React 19 and Vite for a local dashboard; custom CSS and SVG rather than a component or graph framework.
- Atomic JSON files for single-user evidence history; no database server or message broker needed for the bounded workload.
- Node built-in test runner with real disposable Git repositories and HTTP processes.

`package-lock.json` records installed dependency versions. `package.json` owns scripts and supported runtime range.

## Architecture choice
A modular monolith owns analysis, run coordination and persistence. The instrumented reference services are separate processes because failures and dependency boundaries are the subject of the experiments. A separate control-plane service fleet would add complexity without helping this local release.

Docker is not required. The installed Docker CLI could not reach its engine during initial inspection on 2026-10-24; container isolation is not implemented or claimed. Runs are local loopback HTTP workloads, with verified bundled source only.

The current authenticated reference uses `.faultline/demo-v2`; prior reference files and evidence remain intact. Each experiment uses an ephemeral capability token shared by its HTTP services and runner, without saved credentials. Static files are served only after final realpath containment checks under the canonical build root.

## Runtime setup
On Windows x64, `pwsh -NoProfile -File scripts/setup-runtime.ps1` downloads the official Node 22.23.4 executable to `.faultline/runtime/node.exe`. The installer validates the official SHA256 checksum, Windows Authenticode signature and reported version before replacing the project runtime. It makes no global installation or PATH changes. Actual installation and passing tests are separate evidence, recorded in `status.md`.

Project npm commands use `scripts/runtime.mjs`, which selects a supported active Node 22 or the project portable executable and fails with setup guidance if neither is available. It does not silently use an older Node. Other platforms must install a supported Node 22 runtime themselves.

## Commands
Set up a supported runtime first, then `npm ci`, `npm run check`, `npm test`, `npm run build`, `npm start` (http://127.0.0.1:4317). `npm run dev` starts the backend and Vite (http://127.0.0.1:5173). `PORT` changes the backend production port. No user-provided environment secrets are required.
