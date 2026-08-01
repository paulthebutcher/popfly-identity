// GET /e/export — authenticated read path for Reach.
// STUB — no implementation until Build Plan Phase 1. HARD-GATED on Phase 0c
// (pull vs push decision with the Reach ETL owner); if push wins, this becomes
// a Worker cron instead and this route may not exist.
// Contract: spec §4, card "GET /e/export".
//
//   GET /e/export?since=<iso>&until=<iso>&cursor=<id>&table=touches|pageviews
//   Auth: Authorization: Bearer <EXPORT_KEY> — NEVER a query-string key.
//   Cursor-paginated on autoincrement id, 1000 rows/page, stable ordering.
