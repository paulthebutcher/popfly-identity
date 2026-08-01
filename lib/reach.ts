// Reach forwarder with retry + dead-letter.
// STUB — no implementation until Build Plan Phase 1 (gated on Phase 0e:
// confirm Reach ingestion contract unchanged since the April spec).
// Contract: spec §4 (/e/collect step 7).
//
// - POST REACH_WEBHOOK_URL with ?key=<REACH_WEBHOOK_KEY> appended SERVER-SIDE.
//   The key is the rotated one — never the current public key.
// - Retry x3 with backoff (0.5s / 2s / 8s).
// - Terminal failure → dead_letters row + POST ALERT_WEBHOOK_URL.
// - Caller always returns 204 to the browser regardless of Reach's health.
