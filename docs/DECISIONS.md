# Decision Log

Three tiers: **Settled** (spec §8, do not re-litigate), **Proposed** (defaults chosen during repo setup on Aug 1 2026 — veto anytime before Phase 1), and **Open** (Phase 0 gates, spec §9).

## Settled (spec v3.2 §8)

| Decision | Resolution |
|---|---|
| Attribution model | All touches, server-side D1 log, classified at write time. Reach derives any model from the `touches` array without owning the taxonomy. |
| Pageviews | In scope (reopened in v3.2). Separate `pageviews` table; `touches` stays an attribution log. |
| Channel taxonomy | 12 buckets, ordered 13-rule classifier, `rules_version` stamped, raw params always retained. |
| Read path | `GET /e/export`, bearer auth, cursor-paginated. Pull vs push confirmed at Phase 0c. |
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

## Open (Phase 0 gates — see BUILD_PLAN.md for owners and exit criteria)

1. **0a** — D1 write limits vs pageview volume (blocks schema)
2. **0b** — RB2B readable client-side ID: hard key vs fuzzy join (blocks payload contract + script v2.2)
3. **0c** — Read path: Reach scheduled pull vs Worker-cron push (blocks `/e/export` build)
4. **0d** — Reach opportunity stage/value: revenue vs lead attribution claims (blocks first stakeholder report)
5. **0e** — Reach ingestion contract unchanged since April (blocks dual-write)

Record each resolution here with a date when it closes.
