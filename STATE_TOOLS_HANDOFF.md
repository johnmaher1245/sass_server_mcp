# Prod MCP Handoff v3 — gated to last 5 months (created since 2026-01-01)

**What changed:** `analyze_pipeline_by_state` now accepts `created_after` / `created_before`
(matter creation date), so we can exclude the old back-catalog and report only recent intake.
Only `services/queries/states.js` + its tool file changed; no env changes. Because code
changed, **cold-start the prod MCP again**. All calls are read-only.

## 1. Cold start (again — code changed)
1. Sync the updated `server_mcp/` to wherever prod MCP runs.
2. Fully restart / reconnect the `sass-production` MCP connection (re-spawns `node index.js`).
3. Same 3 tools should still be listed.

## 2. Run these calls

**A — current pre-filing pipeline, created since Jan 1 2026** → `analyze_pipeline_by_state`
```json
{ "preset": "bk_pre_filing", "created_after": "2026-01-01" }
```

**Monthly RETAINED by state — one call per month, Jan→May 2026** → `analyze_pipeline_by_state`
(do NOT add created_after here — the month window already defines the cohort)
```json
{ "workflow": "6687baf69188ba72f9dbf508", "cohort_mode": "entered_window", "window_category": "66f2dafb148af4997847911e", "window_start": "2026-01-01", "window_end": "2026-01-31" }
{ "workflow": "6687baf69188ba72f9dbf508", "cohort_mode": "entered_window", "window_category": "66f2dafb148af4997847911e", "window_start": "2026-02-01", "window_end": "2026-02-28" }
{ "workflow": "6687baf69188ba72f9dbf508", "cohort_mode": "entered_window", "window_category": "66f2dafb148af4997847911e", "window_start": "2026-03-01", "window_end": "2026-03-31" }
{ "workflow": "6687baf69188ba72f9dbf508", "cohort_mode": "entered_window", "window_category": "66f2dafb148af4997847911e", "window_start": "2026-04-01", "window_end": "2026-04-30" }
{ "workflow": "6687baf69188ba72f9dbf508", "cohort_mode": "entered_window", "window_category": "66f2dafb148af4997847911e", "window_start": "2026-05-01", "window_end": "2026-05-31" }
```

**C — signal accuracy vs filed cases** (all-time; it's the accuracy check, more data is better) → `validate_state_signals_against_filed`
```json
{ "workflow": "6687baf69188ba72f9dbf508" }
```

## 3. Accuracy check before sending
- For **A**, confirm `"scope": { ... "created_after": "2026-01-01" ... }`.
- For each **monthly** call, confirm `"entered_window_filter": { "field": "step_category_dates.66f2dafb148af4997847911e", ... }` (non-null) and that the month counts **differ** across the five.
- If `created_after` is missing from A's scope, or `entered_window_filter` is null → **STOP and tell me** (stale code is still running).

## 4. Send back
Paste the **full JSON** of A, all five monthly calls, and C (and any `error`). I'll rebuild the
team summary gated to the last 5 months.
