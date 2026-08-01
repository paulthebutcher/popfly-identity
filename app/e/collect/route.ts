// POST /e/collect — form-event ingest, forward to Reach.
// STUB — no implementation until Build Plan Phase 1 (gated on Phase 0e).
// Contract: spec §4, card "POST /e/collect" + "Payload contract (v2)".
//
// Pipeline:
//   1. Gate: same-origin referer/origin check; accept application/json AND
//      text/plain (sendBeacon); body <= 32 KB; per-IP token bucket ~10/min.
//   2. Validate (lib/validate.ts): email present + RFC-shaped; allowlisted keys;
//      length caps.
//   3. Bot signals — FLAG, never drop: honeypot website_url, form_age_ms < 2000,
//      disposable email domain → bot_score. Reach ETL decides.
//   4. Identity merge: cookie pf_vid authoritative; divergent client ID rides
//      along as visitor_id_client.
//   5. Enrich: received_at, event_id = SHA-256(email + session_id + 60s bucket).
//   6. Attach ordered touches array from D1 (cap 50) with channel/source/
//      campaign/touch_index; keep flat first-touch fields for backward compat.
//   7. Forward via lib/reach.ts: retry x3 (0.5s/2s/8s); terminal failure →
//      dead_letters + alert. Browser ALWAYS gets 204.
