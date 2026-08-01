# Reach-Side Obligations (living document)

Everything the Reach ETL owner must build or configure, organized by when it's needed. The identity endpoint produces data; **Reach owns all ETL and all reporting** (spec §6). Paul confirmed Aug 1 2026 the ingestion contract is ours to define — this doc *is* that contract's Reach-side checklist.

Update this file whenever the build adds or changes a Reach-facing behavior. Each item has a deadline phase from [BUILD_PLAN.md](../BUILD_PLAN.md).

---

## 1. Before dual-write starts (Phase 4 entry) — REQUIRED

### 1.1 Deduplicate on `event_id`
During the 3–5 day dual-write window, every form submit arrives **twice**: once via n8n (old path) and once via `/e/collect` (new path). Reach must dedupe. The new path sends `event_id` = SHA-256(email + session_id + 60-second bucket); the n8n path doesn't carry it, so practical dedupe is: match on email + timestamp proximity (±2 min), keep the endpoint record (it's strictly richer), or simply tolerate doubles for the window and dedupe in reporting. **Decide the mechanism before the window opens.**

### 1.2 Map payload v2

**A real generated example lives at [samples/payload-v2-example.json](samples/payload-v2-example.json)** — produced by the dev harness through the actual endpoint (multi-touch journey: paid_search → organic_search → organic_social), so it is byte-accurate to what Reach will receive. Review it async; the shape is ours to change if anything is awkward on the ETL side.
New fields on every `/e/collect` event (full contract in the [README](../README.md) and spec §4):

| Field | Type | Notes |
|---|---|---|
| `visitor_id` | string | Server cookie ID — authoritative |
| `visitor_id_client` | string? | Present only when a pre-migration localStorage ID diverges — use to stitch old history |
| `rb2b_id` | string? | RB2B's `_reb2buid` UUID. Store it even though RB2B doesn't export it today — future-proofing |
| `session_id` | string | Server-derived, 30-min inactivity window |
| `touches` | array | Ordered, ≤50 (the first touch + the most recent 49), each: `{ts, channel, source, medium, campaign, landing_page, referrer, touch_index, rules_version}` — **authoritative**. `touch_count` reports the true total and may exceed the array length; the full log always arrives via the nightly batches (§2). |
| `first_touch_channel`, `last_touch_channel` | string | Denormalized convenience copies of the array's endpoints |
| `touch_count`, `session_count` | int | |
| `first_seen_at` | ISO string | |
| `first_seen_before_launch` | bool | **See 1.4 — load-bearing** |
| `bot_score` | number 0–1 | **See 1.3** |
| `form_age_ms` | int | Raw signal behind bot_score |
| `event_id`, `received_at` | | Dedupe handle + server timestamp |
| `geo_city`, `geo_country` | string? | Coarse Cloudflare geo — used for the RB2B join (§3) |
| `source` | string | `"identity_endpoint"` — routing discriminator |
| *(flat first-touch fields)* | | `utm_*`, `gclid`, `landing_page`, etc. kept for backward compat with the existing mapping — prefer the array |
| *(passthrough form fields)* | | Every named form element arrives under its Webflow `name` attribute. **The persona/business-type field is load-bearing** (creator-vs-brand splits, qualified-lead gating in reporting) — its exact field name is captured during the Phase 4 pre-paste check; map it explicitly, don't guess. `website_url` (honeypot, expected empty) and `form_age_ms` also ride along. |

### 1.3 Bot policy: the endpoint flags, Reach decides
The endpoint **never drops** a submission (spec §8). `bot_score` (0–1, from honeypot + form_age_ms < 2s + disposable email domain) and `is_bot` (UA-based, on touches/pageviews) arrive as data. Reach ETL must choose and document a threshold (suggested: exclude `bot_score ≥ 0.6` from lead routing but retain rows; filter `is_bot = 1` from all traffic metrics). No real lead should ever be silently eaten — that guarantee now lives on Reach's side.

### 1.4 Exclude test records
`source: "identity_endpoint_test"` → exclude from all lead routing and reporting. Used throughout staging (Phase 2) and smoke tests (Phase 3), so this filter must exist **before** Phase 2, or test records pollute Reach.

### 1.5 Honor `first_seen_before_launch`
The touch log starts empty at cutover, so `touch_index` and `touch_count` are **wrong for every pre-launch visitor** (spec §6 caveat 1). Any multi-touch metric (touches-to-conversion, assisted conversions, time-to-conversion) must filter to `first_seen_before_launch = false`. Build this into the base queries, not as an analyst convention.

---

## 2. Nightly history batches (before Phase 4) — REQUIRED

`POST` from `/e/push` to the **same webhook URL** as form events, nightly. Envelope:

```
{
  "source": "identity_endpoint_history",   // route on this
  "table": "touches" | "pageviews",
  "rows": [ ... up to 500 per POST, same columns as D1 ... ],
  "high_water_mark": <int>,                // last row id included
  "sent_at": <ISO>
}
```

Reach must:
- **Route on `source`** — these are not leads; never trigger lead workflows from them.
- **Upsert idempotently on row `id` + `table`** — the push is high-water-mark based and re-sends on retry after partial failure; duplicates are expected and must be harmless.
- **Store rows keyed by `visitor_id`** so converting leads (1.2) and RB2B profiles (§3) can join to them.
- Return 2xx quickly; non-2xx makes the endpoint hold the mark and retry next run.

---

## 3. The RB2B fuzzy join (when RB2B reporting is wanted) — REQUIRED for the "sourced accounts" metric

RB2B's outbound side (webhook + daily CSV, verified Aug 1 2026 across 283 rows) carries **no visitor UUID** — person/company-level fields only. The join between an RB2B profile and our touch/pageview history is therefore **fuzzy, built in Reach ETL**:

- **Match keys:** RB2B `(RecentPageUrls, LastSeenAt, City)` ↔ ours `(path, ts, geo_city)`.
- Suggested tolerance: same normalized path, `ts` within ±30 min of `LastSeenAt`, city case-insensitive match (fall back to state/country on miss). Tune against real data.
- **Confidence tiers:** Person rows with `WorkEmail` can also join exactly on email once they convert. Company rows (no person) match loosest — label the join quality on every stitched record.
- If RB2B ever exposes `_reb2buid` through an integration, our log already has it on every row (`rb2b_id` via `/e/v`) — the fuzzy join upgrades to exact with zero endpoint changes.
- One outstanding check (cheap): dump one real RB2B **webhook** payload and confirm it matches the CSV shape — no hidden ID field.

---

## 3b. Interim third source: `fit_assessment` (until that app consolidates)

The fit-assessment app currently delivers leads via its own route with `source: "fit_assessment"` — no `event_id`, no visitor/session IDs, no touch history, no bot flags. Until it's consolidated onto `/e/collect` (planned at its launch; see BUILD_PLAN "After this build"), Reach must: route it as a lead source, dedupe against `identity_endpoint` leads by email only, and expect no journey data on these records. After consolidation these arrive as normal payload-v2 events with `form_id: "fit-assessment"` and this section becomes obsolete.

## 4. Cutover day (Phases 6–7) — REQUIRED, coordinated

1. **Issue a new webhook key** for the identity endpoint (goes into the `REACH_WEBHOOK_KEY` env var — never into client code).
2. Confirm leads flow from `/e/collect` alone once the n8n webhook is removed.
3. **Retire the old (public) key** from WEBHOOK_SOURCE — Paul + COO, same day. This is the actual security fix; until it happens, anyone can still inject leads.
4. Stop dedupe-window handling from 1.1 once single-write is confirmed.

---

## 5. Reporting Reach owns (post-cutover, spec §6)

All Growth/Marketing/Sales metrics in spec §6 are Reach deliverables built on this data: conversion rate by channel (first- and last-touch), touches-to-conversion distribution, time-to-conversion, assisted conversions, new-vs-returning, path depth/dropoff, creator-vs-brand persona splits, paid-vs-organic Google, campaign performance, landing-page-by-channel, `unknown`-bucket hygiene alarm, AI-referral trend, lead context at handoff, intent scoring, re-engagement triggers.

Standing caveats to bake into dashboards:
- **`unknown` ≠ `direct`** — keep them separate; a rising `unknown` share is a campaign-tagging alarm, not traffic.
- **Returning-visitor rate will jump at cutover** — measurement correcting, not growth. Pre-brief Taylor + Maren.
- **Revenue attribution is future state** (0d deferred) — nothing in the current contract carries deal stage or value; all reporting is lead attribution.
- Volume caveat (spec §6): channel comparisons are directional for the first months, not statistically decisive.

---

## Changelog

- **Aug 1 2026** — initial version, written at Phase 1 start. Contract basis: Paul's confirmation that payload shape is ours to define and all ETL lives in Reach.
