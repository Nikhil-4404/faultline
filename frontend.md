# Dashboard

The dashboard is an engineering workspace with Impact Explorer, Wind Tunnel, Evidence and Architecture views.

- Impact: repository/ref form; bundled reference shortcut; changed source, interactive dependency graph, impact chains and analysis limitations.
- Wind Tunnel: supported scenarios, bounded workload input, active progress/cancellation, measured baseline/candidate comparison, correctness findings and service traces.
- Evidence: saved runs, status and JSON export; no seeded result counts or fake completed runs.
- Architecture: explains the implemented local system and reference service boundaries.

All measurements come from the API. The reference application is labeled as a fixture; its HTTP executions and observations are real. Predictions and observed experiment outcomes remain visibly distinct. External repository analysis disables reference experiment execution.

Forms have labels, actions use semantic buttons, focus is visible and graph selection has accessible controls. Responsive layout and key user journeys require browser verification; see status.md for evidence.
