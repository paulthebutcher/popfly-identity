# Build Plan — Popfly Identity Server

Derived from [Build Spec v3.2](docs/spec-v3.2.html) §7 (delivery plan) and §9 (verify before build), expanded with owners, exit criteria, and sequencing rationale. Decision log: [docs/DECISIONS.md](docs/DECISIONS.md).

**Effort (spec §7, revised):** endpoint + D1 + tests ~1 day · classifier + host lists + tests ~0.5 day · read path ~0.5 day · script v2.2 ~2–3 hrs · Cloud setup ~1–2 hrs · dual-write window 3–5 elapsed days. **Roughly 2 days of build.** Long pole: key-rotation coordination, with the read-path decision (0c) a close second. Running cost $0 within the Business plan.

---

## Phase 0 — Verification gates (status as of Aug 1 2026: 0a, 0b, 0c, 0e closed; 0d deferred. Only 0f remains — the cron test, folded into Phase 1)

These block *design choices*, not just lines of code — closing them after the schema or push contract is live means rework.

| # | Item | Why it gates | Status / exit criteria | Owner | Blocks |
|---|---|---|---|---|---|
| 0a | **D1 write limits** under Webflow Cloud's plan allocation vs an estimated pageview ceiling | Pageview volume is an order of magnitude above form events. If writes are capped low, the answer is sampling or rollup — and that changes the schema. | ✅ **CLOSED Aug 1 2026.** Webflow Cloud's [limits page](https://developers.webflow.com/webflow-cloud/limits) documents **no daily write cap** for SQLite (KV has one; SQLite doesn't) — the binding constraint is **storage: 1 GB on Business**. Even at the worst-case reading of the RB2B numbers (675 identified pageviews ÷ 5% resolution, daily → ~400k pageviews/mo), the spec's retention rules (90-day pageview prune + rollup, 400-day touches) keep steady-state well under 1 GB. Consequence: **the retention/prune job is required infrastructure, not hygiene** — it runs inside `/e/push`. Residual: absence of a documented write cap ≠ guaranteed unlimited; confirm with Webflow support during Phase 2, and watch for throttling in the dual-write window. No schema change needed. | Paul | ~~Phase 1~~ cleared |
| 0b | **RB2B client-side ID** — does RB2B expose a readable identifier in the browser? | Determines whether the RB2B join is a hard key (`rb2b_id` through `/e/v`) or a fuzzy match on timestamp + URL + city. This log is the *only* channel source for RB2B-identified non-converters (spec §3). | ✅ **CLOSED Aug 1 2026, both halves.** Client side: `_reb2buid` (stable UUID, first-party cookie on `.popfly.com` — Secure, not HttpOnly — mirrored in localStorage; JS-readable); script v2.2 reads localStorage with cookie fallback → `rb2b_id`. Reach side: the daily CSV (283 rows checked) carries **no UUID** — outbound is person/company-level only. **Join is fuzzy: RB2B's (RecentPageUrls, LastSeenAt, City) vs our (path, ts, geo_city)** — hence the `geo_city`/`geo_country` columns from `request.cf` (DECISIONS.md). Capture `rb2b_id` anyway: free, future-proofs a hard key. Residual: ETL owner dumps one real webhook payload to confirm no hidden ID field. | Paul | ~~cleared~~ |
| 0c | **Read path direction** — pull vs push | Inverts the read path; hard to retrofit once the schema and contract are live. | ✅ **CLOSED Aug 1 2026: push, contract ours to define.** Reach cannot run a scheduled pull → `GET /e/export` replaced by `POST /e/push` (batch push + retention prune), triggered by a GitHub Actions nightly cron since Webflow Cloud documents no native cron support (re-verify `triggers.crons` at Phase 1). Paul confirmed we can send whatever payload we want — Reach does all ETL and the ingestion contract can change. Working design: batches POST to the existing `REACH_WEBHOOK_URL` with a distinct `source: "identity_endpoint_history"` envelope so the normalizer routes them apart from form events. Reach ETL mapping for the new source is Phase 4 coordination, not a blocker. | Paul | ~~cleared~~ |
| 0f | **Webflow Cloud cron support** — does `triggers.crons` in `wrangler.jsonc` actually fire? | Decides whether `/e/push` needs the GitHub Actions trigger at all. Undocumented; assume not. | **OPEN — test empirically at Phase 1** on the first staging deploy. If honored, drop the Actions workflow; if ignored (expected), ship the Actions cron. Either way `/e/push` itself is unchanged. | Paul | Phase 1 (trigger mechanism only) |
| 0d | **Reach opportunity data** — does Reach hold deal stage and value? | Decides whether stakeholder claims can include revenue attribution or only lead attribution. | ⏸ **DEFERRED Aug 1 2026** (Paul: future state, not a current concern). All stakeholder framing stays lead-attribution-only until revisited. No longer gates anything near-term. | Paul + Taylor | — (future state) |
| 0e | **Reach ingestion contract unchanged** since the April spec (`?key=` validation, `email` required, normalizer sets eventType) | Dual-write fails silently if the normalizer changed. | ✅ **CLOSED Aug 1 2026 — moot.** Paul: the contract is ours to change; Reach does all ETL. The risk inverts from "silent normalizer drift" to "coordinate the ETL mapping for payload v2 (and the `identity_endpoint_history` batch source) before dual-write" — that coordination is now a Phase 4 entry task, with the parity check (step 5) as the safety net. | Paul | ~~cleared~~ (Phase 4 coordination task remains) |

Also close with the Reach ETL owner before Phase 4: the **dedup contract** (`event_id` on events, `dedup_key` on touches) and the **test-record convention** (`source: "identity_endpoint_test"` → excluded by Reach ETL).

---

## Phase 1 — Scaffold, schema, classifier ✅ (built + verified locally Aug 1 2026)

**Verified on local Workers runtime + D1:** cookie mint/persist and rolling reissue; server-side session reuse across hits; classification correct for a paid→internal→organic journey (`paid_search` → `internal` suppressed → `organic_search`, `touch_index` 1/2, `rules_version` stamped, `geo_city` populated); refresh replay deduped by `dedup_key`; `/e/collect` 204/422/403 + dead-letter after 3 retries with payload preserved; `/e/push` 401 without bearer, holds the high-water mark when the sink rejects. 36 classifier tests green; `tsc` and `next build` clean. Remaining from this phase: the 0f cron test (needs a staging deploy — moved to Phase 2).

**Step 1: repo + local preview.**
- Init the Next.js App Router project (route handlers only) with the Webflow Cloud toolchain; repo lives in the Popfly GitHub org (access sorted at kickoff — no personal accounts). ⚠️ This directory already contains doc/stub files; scaffolders expect an empty dir — init in a temp dir and merge, or force-init, replacing each stub with its implementation.
- Write `migrations/001_init.sql` per spec §4 (`touches`, `pageviews`, `dead_letters`, indexes, retention notes) — 0a closed with no volume-driven change; retention enforcement moves to `/e/push`. One addition over spec §4: `geo_city`/`geo_country` TEXT columns on both event tables, populated from `request.cf` in `/e/v` (coarse city only, no IP) — required by the fuzzy RB2B join (0b outcome).
- Implement `/e/v` (bot gate → cookie → server-side session → pageview write → classify → conditional touch write) and `/e/collect` (gate → validate → bot-flag → identity merge → enrich → attach history → forward with retry → always 204). Implement `/e/push` (high-water-mark batch push per the 0c-signed contract + retention prune) once the Reach batch contract is signed. `/e/healthz`.
- **Scheduler check:** try `triggers.crons` in `wrangler.jsonc` on a test deploy — if Webflow Cloud honors it (undocumented, assume not), drop the external trigger; otherwise add a nightly GitHub Actions workflow that curls `POST /e/push` with the `PUSH_KEY` bearer (key stored as a GitHub Actions secret).
- **Exit:** local wrangler preview at the mount path: `/e/v` sets `pf_vid` and writes both tables; `/e/collect` logs locally.

**Step 1a: classifier unit tests** (proposed: Vitest — see DECISIONS.md).
Test against the *production* referrer list from spec §3, not synthetic data.
- **Exit:** all 13 rules covered; `android-app://` mappings (gm → email, linkedin.android → organic_social, googlequicksearchbox → organic_search) pass; all four owned domains suppress; **`gclid` with no UTMs classifies as `paid_search`, never `direct`**; `unknown` and `direct` produce distinct results; `rules_version` stamped on every classification.

## Phase 2 — Staging

Webflow Cloud app created, GitHub connected, env vars set (`REACH_WEBHOOK_URL`, `REACH_WEBHOOK_KEY` *(rotated key — never the current public one)*, `ALERT_WEBHOOK_URL`, `PUSH_KEY`), staging deploy. Ask Webflow support to confirm the no-write-cap reading of the SQLite limits (0a residual). **Prerequisite: decide the `ALERT_WEBHOOK_URL` destination** (Slack incoming webhook is the obvious candidate) — dead-letter alerts with nowhere to land defeat the monitoring story. **At Phase 6, also set `LAUNCH_TS`** to the cutover timestamp or the cold-start guard never fires.
- **Exit:** Safari **and** Chrome: `pf_vid` persists across a full browser restart (the ITP fix, verified — this is the headline claim); `/e/collect` produces a tagged test record in Reach (`identity_endpoint_test`); a manually triggered `/e/push` run delivers a batch and prunes correctly against seeded data.

## Phase 3 — Production deploy, unreferenced

Deploy to popfly.com/e with nothing pointing at it yet.
- **Exit:** curl smoke tests pass on `popfly.com/e/healthz`, `/e/v` (cookie + `Cache-Control: no-store`), `/e/collect` (204), `/e/push` (401 without bearer; runs idempotently with).

## Phase 4 — Script v2.2 + dual-write (3–5 elapsed days)

Script v2.2 is authored and versioned at [docs/webflow-head-script-v2.2.js](docs/webflow-head-script-v2.2.js) (all five spec §5 edits: new params, `/e/v` with server-ID adoption, sendBeacon → `/e/collect` with keepalive fallback and native submission untouched, injected honeypot + `form_age_ms` + extended `?debug=pf`, `_reb2buid` capture). Deploy = paste into Webflow Site Settings → Custom Code → Head. **Pre-paste check:** hidden-field names on `/start/new` match `getFormValues()` keys; record the `name` attribute of the business-type field (`#business-type-field`) and give Reach the persona mapping (REACH.md §1.2); a `?debug=pf` pass on staging shows populated fields + server channel. **The form-page embed script (form + Calendly + GrowSurf + qualified_lead) needs NO changes** — verified Aug 1 2026 against v2.2: it consumes `PopflyTracking.getFormValues()`, whose contract v2.2 preserves; capture-phase beacon fires before its bubble-phase handler; GrowSurf metadata now carries server-adopted IDs, making participants joinable to the touch log. No new hidden fields required — the beacon reads the live form, not hidden inputs (optionally add `gad_source`/`gad_campaignid`/`msclkid` hidden inputs if n8n-side parity records should carry them during the dual-write window). Heads-up: the injected `website_url` honeypot shows as an empty field in Webflow notification emails.
Endpoint and n8n both live; Reach dedupes on `event_id` (0e confirmed first).
- **Exit:** endpoint volume ≈ n8n volume over the window.

## Phase 5 — Parity + manual journey test

**5: parity check — form events only.** n8n never carried touches or pageviews, so there is nothing historical to compare those against; they get 5a instead.
- **Exit:** delta < ~2% or explained.

**5a: manual journey test.** Hit a paid ad URL → return via Google search → return direct.
- **Exit:** exactly three touch rows (`paid_search`, `organic_search`, `direct`); one `visitor_id`; `touch_index` 1/2/3; pageview count matches actual navigations; **a second open tab does not create a second session** (server-side session derivation working).

## Phase 6 — Cutover

New Reach key in the env var; `LAUNCH_TS` set; Webflow→n8n webhook disconnected and the n8n form workflow **deactivated (not deleted)** — it stays as the rollback path until Phase 8 closes clean, then gets deleted.

**Before deactivating: inventory the n8n workflow's nodes for side-effects** beyond the Reach forward (Slack pings, sheet appends, tags in other tools). Anything found gets rehomed — Reach is usually the right new home, since it now receives a richer event than n8n ever did. Note: this retires the *form workflow*; decommissioning the n8n instance entirely is a separate decision that needs an instance-wide workflow inventory first.
- **Exit:** leads flow end-to-end; `dead_letters` empty.

## Phase 7 — Old key retired

Old key removed from WEBHOOK_SOURCE (Paul + COO, scheduled for cutover day). **This is the actual security fix** — the old key is public; everything before this is preparation.
- **Exit:** old key rejected by Reach.

## Phase 8 — Monitor, 2 weeks

- **Exit:** daily `dead_letters` count steady at zero; weekly event volume matches form fills; `unknown` channel share stable and explained (rising `unknown` = campaign-tagging failure, by design).

---

## After this build (same pattern, separate efforts)

- **Fit-assessment app** (Vite React SPA): wrap for Next, mount on popfly.com, post to `/e/collect`, inherit `pf_vid` automatically, **add history-API hooks** — `pushState` navigations won't fire `/e/v` otherwise and a multi-screen flow records as one pageview. Repo transfers from personal to the Popfly org at wrap time.
- **Deferred permanently or until asked:** Meta/LinkedIn CAPI & Stape, consent banner enforcement, cross-device identity, ad spend import (spec §10).

## Risks

| Risk | Mitigation |
|---|---|
| Undocumented D1 write throttling surfaces despite no documented cap | 0a residual: confirm with Webflow support at Phase 2; watch dual-write window; rollup/sampling remains the designed fallback |
| 1 GB SQLite storage cap reached | Retention prune is mandatory inside `/e/push`; alert if a run's prune fails; storage trend checked during Phase 8 monitoring |
| Reach batch contract (0c second half) slips | `/e/push` payload shape blocked on ETL owner sign-off — chase alongside 0e in the same conversation |
| GitHub Actions cron misses runs (best-effort scheduling) | Push is high-water-mark idempotent, so a late/missed run self-heals on the next; alert if no successful push in 48h |
| First 90 days of multi-touch data misread by stakeholders | `first_seen_before_launch` flag in payload; caveat delivered to Taylor + Maren **before** the first report (spec §6) |
| Returning-visitor rate jumps at cutover and reads as growth | Pre-brief: it's measurement correcting, not growth |
| Key rotation slips | Paul + COO co-own; scheduled for cutover day, not "after" |
| Reach outage during submits | By design: browser always gets 204; dead_letters + replay |
