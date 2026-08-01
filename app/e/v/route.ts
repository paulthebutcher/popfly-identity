// POST /e/v — identify + touch + pageview, one roundtrip per pageload.
// STUB — no implementation until Build Plan Phase 1 (gated on Phase 0a/0b/0c).
// Contract: spec §4, card "POST /e/v".
//
// Body from head script v2.2: { url, referrer, session_hint, params, rb2b_id? }
//   rb2b_id = RB2B's stable visitor UUID (0b closed Aug 1 2026): script reads
//   localStorage "_reb2buid", falling back to the first-party "_reb2buid"
//   cookie (Secure, not HttpOnly). Optional — absent if RB2B hasn't loaded.
//
// Pipeline:
//   1. Bot gate — UA vs known-crawler list. FLAG (is_bot on both rows), never drop.
//   2. Read pf_vid cookie; missing → mint v_<uuid>.
//   3. Set-Cookie: pf_vid; Domain=.popfly.com; Path=/; Max-Age=34560000;
//      HttpOnly; Secure; SameSite=Lax — reissued every call (rolling 400-day expiry).
//   4. Session derivation SERVER-SIDE (lib/session.ts): reuse last session if
//      < 30 min old, else mint. Client session_hint is a hint only.
//   5. Always write a pageviews row.
//   6. Classify (lib/classify.ts), then write a touches row iff channel != internal
//      AND (new session OR attribution param OR external referrer) AND dedup_key fresh.
//   7. Return { visitor_id, session_id }. Same-origin; Cache-Control: no-store.
