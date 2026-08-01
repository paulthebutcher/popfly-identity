// POST /e/push — scheduled batch push to Reach + retention maintenance.
// STUB — no implementation until Build Plan Phase 1.
// REPLACES GET /e/export: Phase 0c closed Aug 1 2026 — Reach cannot run a
// scheduled pull, so we push. Receiving endpoint + batch payload shape still
// need sign-off from the Reach ETL owner (the remaining half of 0c).
//
// Trigger: Webflow Cloud documents no cron/scheduled-handler support
// (verify at Phase 1 by trying triggers.crons in wrangler.jsonc; assume
// ignored). Primary plan: GitHub Actions scheduled workflow in this repo
// curls this route nightly. Auth: Authorization: Bearer <PUSH_KEY> — never
// a query-string key.
//
// Per run:
//   1. Push: read touches + pageviews rows since the last high-water mark
//      (stored in D1), batch-POST to the Reach endpoint agreed in 0c,
//      advance the mark only on confirmed receipt. Idempotent on re-run.
//   2. Prune: delete pageviews > 90 days (after daily path-count rollup)
//      and touches > 400 days. REQUIRED, not hygiene — Business plan caps
//      SQLite storage at 1 GB (Webflow Cloud limits page, checked Aug 1
//      2026); retention is what keeps steady-state comfortably under it.
