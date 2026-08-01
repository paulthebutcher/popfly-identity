// Schema validation + bot checks for /e/collect and /e/v.
// STUB — no implementation until Build Plan Phase 1.
// Contract: spec §4 (/e/collect steps 1–3; /e/v step 1).
//
// - email: present, RFC-shaped; allowlisted payload keys; length caps; <= 32 KB.
// - Bot signals FLAG, never drop: honeypot website_url, form_age_ms < 2000,
//   disposable email domain → bot_score. Known-crawler UA list → is_bot on /e/v.
//   No real lead is ever silently eaten; Reach ETL decides.
