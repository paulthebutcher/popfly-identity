// Classifier unit tests — Build Plan step 1a (proposed runner: Vitest).
// STUB — no implementation until Build Plan Phase 1.
//
// Test against the PRODUCTION referrer list (spec §3, RB2B daily export,
// 479 profiles), not synthetic data: google.com, l.threads.com, bing.com,
// facebook.com, duckduckgo.com, linkedin.com, instagram.com, search.yahoo.com,
// chatgpt.com, substack.com, android-app://com.google.android.gm,
// android-app://com.linkedin.android, guide.popfly.com, app.popfly.com.
//
// Exit criteria (must all pass):
// - All 13 rules covered.
// - gclid with NO utm params → paid_search / google (never direct).
// - android-app:// scheme mapped, never dropped to unknown.
// - All four OWNED_DOMAINS → internal, touch suppressed.
// - unknown and direct are distinct outcomes.
// - Every classification carries RULES_VERSION.
