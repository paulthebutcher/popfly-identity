# Popfly Identity Server

First-party visitor identity, attribution, and event delivery for popfly.com. Runs as a Webflow Cloud app mounted at `popfly.com/e`, so everything is same-origin — no third-party endpoints for ad blockers to match, no ITP storage caps to fight, no client-exposed API keys.

**Status: pre-build.** The repo is a documented scaffold — every `.ts` and `.sql` file is a comment-only stub describing what goes there. No implementation exists yet. Phase 0 verification gates: 0a (D1 limits) closed Aug 1 2026 — storage, not write rate, is the constraint; 0c closed as **push** (Reach can't pull); 0b, 0e, and the 0c batch contract remain open. See [BUILD_PLAN.md](BUILD_PLAN.md) Phase 0.

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
| `/e/push` | POST | Bearer-authenticated (`PUSH_KEY`) scheduled maintenance: batch-push `touches`/`pageviews` since the last high-water mark to Reach (idempotent), then prune retention (90-day pageviews after rollup, 400-day touches). Triggered nightly by a GitHub Actions cron in this repo — Webflow Cloud documents no native cron support (re-verify at Phase 1). Never a query-string key. |
| `/e/healthz` | GET | Uptime check. |

### Data (D1)

Three tables — full schema in spec §4, stub in [migrations/001_init.sql](migrations/001_init.sql):

- **`touches`** — attribution log only (not a pageview log). Channel, source, medium, campaign derived at write time by the ordered 13-rule classifier; raw params and referrer always stored unmodified; `rules_version` stamped on every row for precise reclassification; `dedup_key` (30-min bucket) stops refresh spam. Retention 400 days, matching cookie life.
- **`pageviews`** — every pageload, written on the same `/e/v` call (zero extra HTTP requests). Retention 90 days raw, then rollup.
- **`dead_letters`** — terminally failed Reach forwards, for replay.

### Channel classifier

Ordered, first match wins, lives in `lib/classify.ts` (stub). The two rules people get wrong, called out here because they're the point:

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

### Repo layout

```
popfly-identity/
├── README.md                  ← you are here
├── BUILD_PLAN.md              ← phased delivery plan with exit criteria
├── docs/
│   ├── spec-v3.2.html            ← authoritative build spec
│   ├── DECISIONS.md              ← decision log (settled, proposed, open)
│   └── rb2b-devtools-checklist.md ← Phase 0b runbook
├── app/e/
│   ├── v/route.ts             ← POST /e/v          (stub)
│   ├── collect/route.ts       ← POST /e/collect    (stub)
│   ├── push/route.ts          ← POST /e/push       (stub)
│   └── healthz/route.ts       ← GET  /e/healthz    (stub)
├── lib/
│   ├── validate.ts            ← schema + bot checks           (stub)
│   ├── classify.ts            ← channel classifier + RULES_VERSION (stub)
│   ├── session.ts             ← server-side session derivation (stub)
│   ├── reach.ts               ← forwarder with retry           (stub)
│   └── db.ts                  ← D1 access via getCloudflareContext (stub)
├── migrations/
│   └── 001_init.sql           ← touches, pageviews, dead_letters (stub)
├── tests/
│   └── classify.test.ts       ← classifier tests vs production referrer list (stub)
├── .dev.vars.example          ← env var names for local dev (no values)
└── .gitignore
```

Not yet present, generated at Build Plan step 1 by the framework/Webflow Cloud tooling: `package.json`, `next.config.*`, `tsconfig.json`, `wrangler.jsonc`, `webflow.json`, `open-next.config.*`. **Note:** scaffolding tools usually want an empty directory — step 1 will need to init in a temp dir and merge, or force-init around these stubs. Flagged in BUILD_PLAN step 1.

### Local development & deploy (to be verified at step 1)

The intended flow, per Webflow Cloud's docs at time of writing — exact commands to be confirmed when the toolchain is installed:

1. Webflow Cloud project created in the Webflow dashboard, connected to this repo on GitHub, mount path `/e`, D1 binding + env vars configured there.
2. Local preview via the Webflow CLI / wrangler dev server; secrets in a local `.dev.vars` (gitignored).
3. Deploys are pushes to the connected branch — GitHub auto-deploy, no manual publish.

### Related systems (not in this repo)

- **Head script v2.2** — lives in the Webflow site's custom code. Five edits over v2.1, spec §5.
- **Reach** — receives form events in real time (`/e/collect` forward) and touch/pageview history in nightly batches (`/e/push`); it cannot run scheduled pulls (Phase 0c, closed Aug 1 2026). Batch endpoint + payload shape still need Reach ETL owner sign-off. Owns all ETL and the reporting in spec §6.
- **RB2B** — stays a direct webhook to Reach for lead delivery; contributes `rb2b_id` to `/e/v` for joining *if* a readable client-side ID exists (Phase 0b).
- **GrowSurf, GTM** — unchanged.
- **n8n form workflow** — deleted at cutover.
