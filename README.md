# Popfly Identity Server

First-party visitor identity, attribution, and event delivery for popfly.com. Runs as a Webflow Cloud app mounted at `popfly.com/e`, so everything is same-origin — no third-party endpoints for ad blockers to match, no ITP storage caps to fight, no client-exposed API keys.

**Status: Phase 1 built and verified locally (Aug 1 2026).** All four endpoints are implemented and smoke-tested on the Workers runtime with local D1: cookie identity, server-side sessions, classification, touch dedup, internal suppression, dead-lettering + automatic nightly replay, push auth + high-water marks, and transactional retention pruning. The automated suite has 43 tests. Next: Phase 2 — create the Webflow Cloud app, connect GitHub, set env vars, staging deploy (plus the 0f cron test). Reach-side obligations live in [docs/REACH.md](docs/REACH.md). Phase 0 outcomes: no D1 write cap (1 GB storage is the constraint — retention prune is mandatory, runs in `/e/push`); read path is push (GitHub Actions nightly cron); Reach contract is ours to define; RB2B join is fuzzy (client `_reb2buid` captured; their exports carry no UUID) — hence `geo_city`/`geo_country` from `request.cf`.

**Source of truth:** [docs/spec-v3.2.html](docs/spec-v3.2.html) (Build Spec v3.2, Jul 31 2026). Where this README and the spec disagree, the spec wins. Decisions and their status live in [docs/DECISIONS.md](docs/DECISIONS.md).

---

## What this buys us (for Taylor, Maren, and the Reach ETL owner)

Today, Popfly has no reliable answer to "which channel produced this lead," Safari forgets returning visitors after 7 days, the Reach webhook key is exposed in client-side code, and visitors who never fill out a form leave no channel history at all. After cutover, this service provides:

- **A durable visitor identity** that survives Safari's tracking protections and localStorage clears, because the cookie is set server-side by our own origin.
- **Every attribution touch logged and classified** into 12 channels (paid search, organic search, paid social, organic social, AI referral, referral program, email, direct, unknown, etc.) at the moment it happens — including separating paid Google from organic Google for the first time.
- **Every pageview logged**, not just the 5–20% of visitors RB2B happens to identify.
- **Form leads delivered to Reach** with the visitor's full ordered touch history attached — validated, retried on failure, deduplicated, and never blocked by a Reach outage.
- **A scheduled push of touch and pageview history to Reach** (`POST /e/push`, nightly) covering visitors who *never* converted — which, combined with the RB2B join, is the only way RB2B-identified accounts ever get channel data (RB2B will never supply it; spec §3).

Two caveats before the first report is read (spec §6): the touch log starts empty at cutover, so **multi-touch metrics lie for the first ~90 days** for any visitor whose history predates launch (the `first_seen_before_launch` flag exists to filter them out), and **current volume is too low for statistically decisive channel comparisons** — directionally useful immediately, decisive in months.

What it deliberately does **not** do: revenue attribution (needs opportunity data in Reach — unconfirmed), CAC/ROAS (no spend data), cross-device journeys (cookie is per-browser), or impression/view-through attribution.

---

## Architecture (for whoever builds and maintains this)

```
www.popfly.com  (Webflow site)
│
├─ <head>: attribution script v2.2  (lives in Webflow site settings, not this repo)
│    page load:   POST /e/v        → identify + touch + pageview
│    form submit: POST /e/collect  → payload via sendBeacon (native Webflow
│                                    submission continues → email notification only)
│
└─ popfly.com/e  (this repo: Webflow Cloud app, Next.js route handlers only)
      validate → merge identity → classify channel → enrich → forward
         └─► POST ops.popfly.com/marketing/api/webhook/events?key=<secret>
              retries ×3 backoff → terminal failure → D1 dead_letters + alert
      POST /e/push  ◄─ nightly scheduler (GitHub Actions cron — Webflow Cloud
                        has no documented cron support)
         └─► batch-push touches + pageviews to Reach, then prune retention
```

**Stack:** Next.js App Router (route handlers only, no pages), OpenNext/Workers runtime, Cloudflare D1 via Webflow Cloud, GitHub auto-deploy. Mount path `/e` (confirmed free on the site).

### Endpoints

| Route | Method | Purpose |
|---|---|---|
| `/e/v` | POST | Identify visitor (mint/refresh `pf_vid` HttpOnly cookie, `Domain=.popfly.com`, rolling 400-day expiry), derive session server-side (30-min inactivity window), classify the touch, write `pageviews` row always and `touches` row when it's a real attribution event. Returns `{ visitor_id, session_id }`. |
| `/e/collect` | POST | Form-event ingest: origin gate, schema validation, bot *flagging* (never dropping), identity merge, touch-history attachment, forward to Reach with retry + dead-letter. Always returns 204 to the browser. |
| `/e/push` | POST | Bearer-authenticated (`PUSH_KEY`) scheduled maintenance: replay unrecovered lead dead letters, batch-push `touches`/`pageviews` since the last high-water mark to Reach (idempotent), then transactionally prune retention (90-day pageviews after rollup, 400-day touches). Triggered nightly by a GitHub Actions cron in this repo — Webflow Cloud documents no native cron support (re-verify at Phase 1). Never a query-string key. |
| `/e/healthz` | GET | Uptime check. |

### Data (D1)

Five tables — full implemented schema in [migrations/001_init.sql](migrations/001_init.sql):

- **`touches`** — attribution log only (not a pageview log). Channel, source, medium, campaign derived at write time by the ordered 13-rule classifier; raw params and referrer always stored unmodified; `rules_version` stamped on every row for precise reclassification; `dedup_key` (30-min bucket) stops refresh spam. Retention 400 days, matching cookie life.
- **`pageviews`** — every pageload, written on the same `/e/v` call (zero extra HTTP requests). Retention 90 days raw, then rollup.
- **`dead_letters`** — terminally failed Reach forwards; unrecovered rows replay automatically during `/e/push` and are stamped with `replayed_at` after Reach accepts them.
- **`pageview_rollups`** — daily path totals retained after raw pageviews age out.
- **`push_state`** — high-water marks for idempotent history delivery.

### Channel classifier

Ordered, first match wins, implemented in `lib/classify.ts`. The two rules people get wrong, called out here because they're the point:

1. **Click IDs before UTMs.** `gclid`/`gad_source` must be checked before UTM fallback, or every auto-tagged Google Ads click classifies as `direct` and the conclusion is "ads don't work."
2. **`unknown` ≠ `direct`.** `direct` is real behavior (no referrer, no params). `unknown` is a data gap. A rising `unknown` count is the campaign-hygiene alarm; collapsing the two hides exactly the bare-landing-URL failure already seen in paid campaigns.

Plus: `android-app://` referrers parse to package names and need explicit mapping; owned domains (`popfly.com`, `www`, `app`, `guide`) classify as `internal` and suppress the touch.

### Environment variables

Set in the Webflow Cloud dashboard, runtime-injected, referenced only inside route handlers. Names (no values) in [.dev.vars.example](.dev.vars.example):

| Var | Secret | Purpose |
|---|---|---|
| `REACH_WEBHOOK_URL` | no | Reach ingestion endpoint |
| `REACH_WEBHOOK_KEY` | **yes** | Rotated key — never the current public one |
| `ALERT_WEBHOOK_URL` | **yes** | Dead-letter alerting |
| `PUSH_KEY` | **yes** | Bearer token authenticating the scheduled trigger of `POST /e/push` (also set as a GitHub Actions secret) |
| `LAUNCH_TS` | no | ISO timestamp of cutover — **must be set at Phase 6** or `first_seen_before_launch` is silently always false and the 90-day cold-start guard never fires |
| `DEV_HARNESS` | no | `1` enables `GET /e/dev-harness`. Local/staging only — **never set in production** |

⚠️ `ALERT_WEBHOOK_URL` needs a decided destination (Slack webhook? email bridge?) before Phase 2 — silent dead-lettering is the failure mode this build exists to prevent.

### Repo layout

```
popfly-identity/
├── README.md                  ← you are here
├── BUILD_PLAN.md              ← phased delivery plan with exit criteria
├── docs/
│   ├── spec-v3.2.html            ← authoritative build spec
│   ├── DECISIONS.md              ← decision log (settled, proposed, open)
│   ├── REACH.md                  ← living Reach-side obligations doc
│   └── rb2b-devtools-checklist.md ← Phase 0b runbook (completed)
├── app/                       ← route handlers; basePath /e = the mount path,
│   ├── v/route.ts             ←   so app/v serves publicly as popfly.com/e/v
│   ├── collect/route.ts       ← POST /e/collect
│   ├── push/route.ts          ← POST /e/push
│   ├── healthz/route.ts       ← GET  /e/healthz
│   └── layout.tsx             ← minimal root layout (build requirement only)
├── lib/
│   ├── classify.ts            ← channel classifier + RULES_VERSION
│   ├── session.ts             ← server-side session derivation
│   ├── validate.ts            ← schema + bot checks + origin gate + rate limit
│   ├── reach.ts               ← forwarder with retry, dead-letter, alert
│   ├── maintenance.ts         ← transactional retention rollup + prune
│   └── db.ts                  ← Cloudflare context, Env type, sha256
├── migrations/
│   └── 001_init.sql           ← touches, pageviews, pageview_rollups, dead_letters, push_state
├── tests/
│   ├── classify.test.ts       ← 39 tests vs the production referrer list
│   ├── reach.test.ts          ← delivery, dead-letter, and replay regressions
│   └── push.test.ts           ← transactional retention regression
├── .github/workflows/
│   └── nightly-push.yml       ← nightly trigger for /e/push (0f fallback)
├── next.config.ts             ← basePath/assetPrefix /e
├── open-next.config.ts · wrangler.jsonc · webflow.json
├── .dev.vars.example          ← env var names for local dev (no values)
└── .gitignore
```

### Dev harness

`GET /e/dev-harness` serves a same-origin test page mimicking head script v2.2 — journey buttons for every channel class and a form that posts to `/e/collect` (with a bot-simulation toggle). Gated behind `DEV_HARNESS=1` (set in `.dev.vars` locally; never set it in the Webflow Cloud dashboard, so it 404s in production). Same origin means cookies, session reuse, and the origin gate behave exactly as they will on popfly.com.

### Local development

```bash
npm install
npm test                                  # classifier suite (vitest)
npm run typecheck
npx opennextjs-cloudflare build           # build the worker bundle
npm run migrate:local                     # apply migrations to local D1
npx wrangler dev                          # serve on :8787 (uses .dev.vars)
```

Copy [.dev.vars.example](.dev.vars.example) to `.dev.vars` (gitignored) with dev values first. Routes serve under the base path locally too: `http://localhost:8787/e/healthz`.

### Deploy

1. Webflow Cloud project created in the Webflow dashboard, connected to this repo on GitHub, mount path `/e`; the D1 binding in [wrangler.jsonc](wrangler.jsonc) is provisioned by Webflow at deploy, and migrations apply automatically.
2. Env vars set in the Webflow Cloud dashboard (see table above).
3. Deploys are pushes to the connected branch — GitHub auto-deploy (or `webflow cloud deploy`).
4. Set `PUSH_URL` + `PUSH_KEY` as GitHub Actions secrets so [nightly-push.yml](.github/workflows/nightly-push.yml) can trigger `/e/push`.

### Related systems (not in this repo)

- **Head script v2.2** — authored and versioned at [docs/webflow-head-script-v2.2.js](docs/webflow-head-script-v2.2.js); deployed by pasting into Webflow Site Settings → Custom Code → Head (Phase 4, only after the endpoint is live). Before pasting, verify the `/start/new` form's hidden-field names match `getFormValues()`.
- **Reach** — receives form events in real time (`/e/collect` forward) and touch/pageview history in nightly batches (`/e/push`, `source: "identity_endpoint_history"` envelope to the same webhook URL); it cannot run scheduled pulls. The payload contract is ours to define — Reach owns all ETL and the reporting in spec §6; coordinate the ETL mapping before dual-write (Phase 4).
- **RB2B** — stays a direct webhook to Reach for lead delivery. Its client-side `_reb2buid` UUID is captured as `rb2b_id` (free, future-proofing), but RB2B's outbound exports carry no UUID, so the working join is **fuzzy**: RB2B's (RecentPageUrls, LastSeenAt, City) matched against our (path, ts, geo_city) in Reach ETL.
- **GrowSurf, GTM** — unchanged.
- **n8n form workflow** — deactivated at cutover as the rollback path; deleted only after Phase 8 closes cleanly.
