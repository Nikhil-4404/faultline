# Backend contracts

Native HTTP API, loopback only, default port 4317. No CORS. Host and Origin validation protects browser-driven mutations from other origins. This is a local single-user application, not an authenticated remote service. JSON request bodies are capped at 16 KB.

| Method | Route | Contract |
| --- | --- | --- |
| GET | `/api/health` | Version, runner kind and active run identity. |
| GET | `/api/demo` | Bundled repository path and baseline/candidate refs. |
| GET | `/api/scenarios` | Four supported scenario descriptions and actual mechanism. |
| GET / POST | `/api/analyses` | History / analyze `{repository, baseRef, headRef}`. |
| GET / POST | `/api/runs` | History / start `{analysisId, scenario, requests}`. |
| GET | `/api/runs/:id` | Current persisted run status, events and result. |
| POST | `/api/runs/:id/cancel` | JSON object body; request active run cancellation. |
| GET | `/api/runs/:id/export` | Download versioned JSON with run, analysis and limits. |

Shared response types are canonical in `packages/shared/src/index.ts`. Errors use `{error: string}`. Invalid body/scenario is 400, forbidden origin is 403, unknown record 404, concurrent work 409, excessive body 413, unsupported content type 415, unsupported repository/experiment 422. During shutdown new mutations return 503.

## Persistence and recovery
Analyses and runs are separate UUID-named JSON records in `.faultline/`. Writes serialize per collection; each writes a unique temporary file then renames it to the record path. This supports a single coordinator, not multiple simultaneous server processes sharing a data directory. Corrupt saved records stop startup rather than silently erasing history. Orphan temporary files are ignored. Atomic replacement is not a guarantee against hardware-level power loss.

One active experiment prevents uncontrolled local resource growth. Saved unfinished states become interrupted after restart. External repository source never becomes an executable experiment. The runner verifies reference source snapshots again at the execution boundary.

When evidence storage fails, health becomes `degraded` and new mutations return 503 until storage is restored and the coordinator is restarted. A failed terminal save is exposed as a failed memory-only record with a clear error and no comparison result; GET, history and export agree. That volatile error record disappears on restart and any last durable unfinished record becomes interrupted. Event-storage failures are failed runs, not user cancellations. Graceful shutdown owns queued persistence through final cleanup and rejects requests whose bodies finish arriving after shutdown starts.
