# Decision Log

Three tiers: **Settled** (spec §8, do not re-litigate), **Proposed** (defaults chosen during repo setup on Aug 1 2026 — veto anytime before Phase 1), and **Open** (Phase 0 gates, spec §9).

## Settled (spec v3.2 §8)

| Decision | Resolution |
|---|---|
| Attribution model | All touches, server-side D1 log, classified at write time. Reach derives any model from the `touches` array without owning the taxonomy. |
| Pageviews | In scope (reopened in v3.2). Separate `pageviews` table; `touches` stays an attribution log. |
| Channel taxonomy | 12 buckets, ordered 13-rule classifier, `rules_version` stamped, raw params always retained. |
| Read path | ~~`GET /e/export`~~ → **`POST /e/push`** (superseded by 0c closure, Aug 1 2026 — see below). Bearer auth principle unchanged: never a query-string key. |
| Session ownership | Server-derived, 30-minute inactivity window. Client sessionStorage is a hint only. |
| Cookie scope | `Domain=.popfly.com`, HttpOnly, Secure, SameSite=Lax, rolling 400-day expiry. |
| Deduplication | Events: `event_id` (SHA-256, 60s bucket). Touches: `dedup_key` (30-min bucket). Communicate to Reach ETL owner before dual-write. |
| Bot handling | Flag, never drop — `is_bot` on both tables, `bot_score` on events; consumers filter. |
| Key rotation | Paul co-owns with COO; scheduled for cutover day. |
| Mount path | `/e` — confirmed free on the site. |
| Repo home | Popfly GitHub org; no personal accounts. |
| Test records | Tag-and-filter via `source: "identity_endpoint_test"`; Reach ETL excludes. |

## Decided at repo setup (Paul, Aug 1 2026)

| Question | Decision |
|---|---|
| Repo scaffold | Docs + real directory scaffold with comment-only stub files; no implementation code until Phase 1. |
| Repo intent | This folder **is** the `popfly-identity` repo root (push to Popfly org, connect to Webflow Cloud). |
| Phase 0 status | All five verification items still open as of Aug 1 2026. |
| README audience | Mixed — plain-English "what this buys us" for Taylor/Maren/Reach ETL owner first, then technical. |
| Repo hosting (interim) | Pushed to `github.com/paulthebutcher/popfly-identity` (personal) on Aug 1 2026. ⚠️ Deviates from the settled "Popfly org, no personal accounts" decision — transfer to the Popfly org at kickoff, before the Webflow Cloud app is connected (Phase 2), so the GitHub connection never has to be re-pointed. |

## Proposed defaults (not yet ratified — veto before Phase 1)

| Default | Rationale | Alternative |
|---|---|---|
| npm as package manager | Webflow Cloud's documented default toolchain | pnpm works if preferred; decide before `package.json` exists |
| Vitest for classifier tests | De-facto standard for Workers/Next projects; fast, no config friction | Jest |
| Spec preserved as `docs/spec-v3.2.html` verbatim | Repo-local source of truth; future spec versions added alongside, never overwritten | — |
| `geo_city` + `geo_country` columns on `pageviews` (and touches) from `request.cf`, added Aug 1 2026 | The RB2B join is fuzzy (no UUID outbound) and City is one of RB2B's three matchable fields; Cloudflare provides coarse geo free on every request. Coarse city-level only — no IP stored. | Skip geo and match on (URL, timestamp) alone — weaker disambiguation for multi-visitor pages |

## Closed Aug 1 2026

| Gate | Resolution |
|---|---|
| **0a — D1 write limits** | Webflow Cloud's [limits page](https://developers.webflow.com/webflow-cloud/limits) documents **no daily SQLite write cap**; the binding constraint is **1 GB storage on Business**. Retention (90-day pageview prune + rollup, 400-day touches) becomes required infrastructure, running inside `/e/push`. No schema change. Residual: confirm no-cap reading with Webflow support at Phase 2. |
| **0c — read path direction** | **Push.** Reach cannot run a scheduled pull. `GET /e/export` replaced by `POST /e/push`: high-water-mark batch push to Reach + retention prune, bearer-auth'd via `PUSH_KEY` (renamed from `EXPORT_KEY`). Trigger: nightly GitHub Actions cron — Webflow Cloud documents no native cron/scheduled-handler support (re-verify `triggers.crons` empirically at Phase 1). **Second half still open:** receiving endpoint + batch payload shape need Reach ETL owner sign-off. |
| **0d — Reach opportunity data** | **Deferred — future state** (Paul). Not a current concern; all stakeholder framing is lead-attribution-only until revisited. No longer gates the build or the first report. |
| **0c (second half) + 0e — Reach contracts** | **Closed Aug 1 2026 — contract is ours to define** (Paul): we send whatever payload we want; Reach does all ETL and the ingestion contract can change. Working design: `/e/push` batches POST to the existing `REACH_WEBHOOK_URL` with `source: "identity_endpoint_history"` so the normalizer routes them apart from form events (`identity_endpoint` / `identity_endpoint_test`). Coordinating the Reach ETL mapping for payload v2 + the batch source moves to Phase 4 entry; the step-5 parity check is the safety net. |
| **0b — RB2B client-side ID** | **Hard key found** (DevTools run, Aug 1 2026): **`_reb2buid`**, a stable UUID persisted in BOTH a first-party cookie on `.popfly.com` (Secure, *not* HttpOnly) and localStorage on `www.popfly.com` — JS-readable either way. Script v2.2 captures it as `rb2b_id` (read localStorage `_reb2buid`, fall back to the cookie). Session counterpart `_reb2bsessionId` exists; `_reb2bsha` (likely hashed email) and `_reb2bgeo` (city blob) noted but unused. Window globals are script internals only; nothing needed from their network traffic. **Second half closed Aug 1 2026: no UUID outbound.** The daily CSV (283 rows checked: 170 Person, 113 Company) carries zero UUIDs — columns are person/company-level only (LinkedInUrl, WorkEmail, name, firmographics, City/State, FirstSeenAt/LastSeenAt, MostRecentReferrer, RecentPageUrls). **Join strategy: fuzzy on the Reach side** — match RB2B's (RecentPageUrls, LastSeenAt, City) against our (path, ts, geo_city). Client-side `rb2b_id` capture stays anyway: zero cost, and becomes a hard key if RB2B ever exposes the ID through an integration. Residual (cheap, non-blocking): have the Reach ETL owner dump one actual RB2B *webhook* payload to confirm it matches the CSV's shape. |

## Open (see BUILD_PLAN.md for owners and exit criteria)

1. **0f** — does Webflow Cloud honor `triggers.crons`? Test empirically on the first staging deploy; expected no → ship the GitHub Actions nightly cron. Trigger mechanism only; `/e/push` unchanged either way.
2. *(cheap residual)* — Reach ETL owner dumps one actual RB2B webhook payload to confirm it matches the CSV shape (no hidden ID field).

Record each resolution here with a date when it closes.
