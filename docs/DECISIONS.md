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

## Closed Aug 1 2026

| Gate | Resolution |
|---|---|
| **0a — D1 write limits** | Webflow Cloud's [limits page](https://developers.webflow.com/webflow-cloud/limits) documents **no daily SQLite write cap**; the binding constraint is **1 GB storage on Business**. Retention (90-day pageview prune + rollup, 400-day touches) becomes required infrastructure, running inside `/e/push`. No schema change. Residual: confirm no-cap reading with Webflow support at Phase 2. |
| **0c — read path direction** | **Push.** Reach cannot run a scheduled pull. `GET /e/export` replaced by `POST /e/push`: high-water-mark batch push to Reach + retention prune, bearer-auth'd via `PUSH_KEY` (renamed from `EXPORT_KEY`). Trigger: nightly GitHub Actions cron — Webflow Cloud documents no native cron/scheduled-handler support (re-verify `triggers.crons` empirically at Phase 1). **Second half still open:** receiving endpoint + batch payload shape need Reach ETL owner sign-off. |
| **0d — Reach opportunity data** | **Deferred — future state** (Paul). Not a current concern; all stakeholder framing is lead-attribution-only until revisited. No longer gates the build or the first report. |

## Open (see BUILD_PLAN.md for owners and exit criteria)

1. **0b** — RB2B readable client-side ID: hard key vs fuzzy join (blocks payload contract + script v2.2). Runbook: [rb2b-devtools-checklist.md](rb2b-devtools-checklist.md).
2. **0c (second half)** — Reach batch endpoint + payload shape for `/e/push` (blocks `/e/push` build).
3. **0e** — Reach ingestion contract unchanged since April (blocks dual-write). Chase in the same conversation as the 0c contract.

Record each resolution here with a date when it closes.
