// Server-side session derivation.
// STUB — no implementation until Build Plan Phase 1.
// Contract: spec §4 (/e/v step 4) and §8 "Session ownership".
//
// session = last session for this visitor_id if its most recent event is
// < 30 minutes old, else mint a new one. The client's sessionStorage value is
// accepted as a HINT only — trusting it (v3.1) meant two open tabs produced
// two sessions and double-counted touches. Verified by Build Plan step 5a.
