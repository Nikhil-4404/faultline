# Technology choices

- Node.js 22.13 or newer; developed on Windows with Node 22.21.1 and Git 2.51.2.
- TypeScript with strict checks, native Node HTTP server and child processes. `tsx` runs backend and development scripts.
- TypeScript compiler API for source parsing; Git via argument arrays without a command shell.
- React 19 and Vite for a local dashboard; custom CSS and SVG rather than a component or graph framework.
- Atomic JSON files for single-user evidence history; no database server or message broker needed for the bounded workload.
- Node built-in test runner with real disposable Git repositories and HTTP processes.

`package-lock.json` records installed dependency versions. `package.json` owns scripts and supported runtime range.

## Architecture choice
A modular monolith owns analysis, run coordination and persistence. The instrumented reference services are separate processes because failures and dependency boundaries are the subject of the experiments. A separate control-plane service fleet would add complexity without helping this local release.

Docker is not required. The installed Docker CLI could not reach its engine during initial inspection on 2026-10-24; container isolation is not implemented or claimed. Runs are local loopback HTTP workloads, with verified bundled source only.

## Commands
`npm ci`, `npm run check`, `npm test`, `npm run build`, `npm start` (http://127.0.0.1:4317). `npm run dev` starts the backend and Vite (http://127.0.0.1:5173). `PORT` changes the backend production port. No environment secrets are required.
