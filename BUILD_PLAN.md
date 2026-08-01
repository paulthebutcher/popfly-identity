# Build Plan — Popfly Identity Server

Derived from [Build Spec v3.2](docs/spec-v3.2.html) §7 (delivery plan) and §9 (verify before build), expanded with owners, exit criteria, and sequencing rationale. Decision log: [docs/DECISIONS.md](docs/DECISIONS.md).

**Effort (spec §7, revised):** endpoint + D1 + tests ~1 day · classifier + host lists + tests ~0.5 day · read path ~0.5 day · script v2.2 ~2–3 hrs · Cloud setup ~1–2 hrs · dual-write window 3–5 elapsed days. **Roughly 2 days of build.** Long pole: key-rotation coordination, with the read-path decision (0c) a close second. Running cost $0 within the Business plan.

---

## Phase 0 — Verification gates (all five OPEN as of Aug 1 2026)

Nothing in Phase 1 starts until 0a–0c are closed; 0d–0e close before their dependent phases. These block *design choices*, not just lines of code — closing them after the schema or read path is live means rework.

| # | Item | Why it gates | Exit criteria | Owner | Blocks |
|---|---|---|---|---|---|
| 0a | **D1 write limits** under Webflow Cloud's plan allocation vs an estimated pageview ceiling | Pageview volume is an order of magnitude above form events (RB2B's 675 identified pageviews at a stated 5–20% resolution rate imply totals in the thousands/mo). If writes are capped low, the answer is sampling or rollup — and that changes the schema. | Documented headroom, or a sampling rule agreed **before** `001_init.sql` is written | Paul | Phase 1 |
| 0b | **RB2B client-side ID** — does RB2B expose a readable identifier in the browser? | Determines whether the RB2B join is a hard key (`rb2b_id` through `/e/v`) or a fuzzy match on timestamp + URL + city. This log is the *only* channel source for RB2B-identified non-converters (spec §3). | ~10 min in DevTools on popfly.com: `rb2b_id` capture confirmed possible, **or** fuzzy-join fallback accepted in writing | Paul | Phase 1 (payload contract), Phase 4 (script v2.2) |
| 0c | **Read path direction** — can Reach run a scheduled pull against `GET /e/export`, or must we push (Worker cron)? | Inverts the read path; hard to retrofit once the schema and export contract are live. | Direction chosen; `/e/export` contract signed off by the Reach ETL owner | Paul + Reach ETL owner | Phase 1 |
| 0d | **Reach opportunity data** — does Reach hold deal stage and value? | Decides whether stakeholder claims can include revenue attribution or only lead attribution. Settle before anyone repeats the stronger claim. | Yes/no answer recorded in DECISIONS.md; §6 claims adjusted if no | Paul + Taylor | First stakeholder report |
| 0e | **Reach ingestion contract unchanged** since the April spec (`?key=` validation, `email` required, normalizer sets eventType) | Dual-write fails silently if the normalizer changed. | Confirmed unchanged, or payload contract updated | Paul + Reach ETL owner | Phase 4 |

Also close with the Reach ETL owner before Phase 4: the **dedup contract** (`event_id` on events, `dedup_key` on touches) and the **test-record convention** (`source: "identity_endpoint_test"` → excluded by Reach ETL).

---

## Phase 1 — Scaffold, schema, classifier

**Step 1: repo + local preview.**
- Init the Next.js App Router project (route handlers only) with the Webflow Cloud toolchain; repo lives in the Popfly GitHub org (access sorted at kickoff — no personal accounts). ⚠️ This directory already contains doc/stub files; scaffolders expect an empty dir — init in a temp dir and merge, or force-init, replacing each stub with its implementation.
- Write `migrations/001_init.sql` per spec §4 (`touches`, `pageviews`, `dead_letters`, indexes, retention notes) — **only after 0a**, since a sampling decision changes it.
- Implement `/e/v` (bot gate → cookie → server-side session → pageview write → classify → conditional touch write) and `/e/collect` (gate → validate → bot-flag → identity merge → enrich → attach history → forward with retry → always 204). Implement `/e/export` per the 0c-signed contract. `/e/healthz`.
- **Exit:** local wrangler preview at the mount path: `/e/v` sets `pf_vid` and writes both tables; `/e/collect` logs locally.

**Step 1a: classifier unit tests** (proposed: Vitest — see DECISIONS.md).
Test against the *production* referrer list from spec §3, not synthetic data.
- **Exit:** all 13 rules covered; `android-app://` mappings (gm → email, linkedin.android → organic_social, googlequicksearchbox → organic_search) pass; all four owned domains suppress; **`gclid` with no UTMs classifies as `paid_search`, never `direct`**; `unknown` and `direct` produce distinct results; `rules_version` stamped on every classification.

## Phase 2 — Staging

Webflow Cloud app created, GitHub connected, env vars set (`REACH_WEBHOOK_URL`, `REACH_WEBHOOK_KEY` *(rotated key — never the current public one)*, `ALERT_WEBHOOK_URL`, `EXPORT_KEY`), staging deploy.
- **Exit:** Safari **and** Chrome: `pf_vid` persists across a full browser restart (the ITP fix, verified — this is the headline claim); `/e/collect` produces a tagged test record in Reach (`identity_endpoint_test`).

## Phase 3 — Production deploy, unreferenced

Deploy to popfly.com/e with nothing pointing at it yet.
- **Exit:** curl smoke tests pass on `popfly.com/e/healthz`, `/e/v` (cookie + `Cache-Control: no-store`), `/e/collect` (204), `/e/export` (401 without bearer, pages with).

## Phase 4 — Script v2.2 + dual-write (3–5 elapsed days)

Ship the five head-script edits (spec §5): new params (`gad_source`, `gad_campaignid`, `msclkid`); fire-and-forget `/e/v` with server-ID adoption; sendBeacon → `/e/collect` with keepalive fallback (native Webflow submission untouched — email notifications only); honeypot + `form_age_ms` + extended `?debug=pf` showing the server's returned channel; `rb2b_id` capture per 0b's outcome.
Endpoint and n8n both live; Reach dedupes on `event_id` (0e confirmed first).
- **Exit:** endpoint volume ≈ n8n volume over the window.

## Phase 5 — Parity + manual journey test

**5: parity check — form events only.** n8n never carried touches or pageviews, so there is nothing historical to compare those against; they get 5a instead.
- **Exit:** delta < ~2% or explained.

**5a: manual journey test.** Hit a paid ad URL → return via Google search → return direct.
- **Exit:** exactly three touch rows (`paid_search`, `organic_search`, `direct`); one `visitor_id`; `touch_index` 1/2/3; pageview count matches actual navigations; **a second open tab does not create a second session** (server-side session derivation working).

## Phase 6 — Cutover

New Reach key in the env var; Webflow→n8n webhook and n8n form workflow removed.
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
| D1 write limits too low for pageview volume | Phase 0a before schema; sampling/rollup fallback pre-agreed |
| Read path shape wrong for Reach | Phase 0c before build; push (Worker cron) is the designed fallback |
| First 90 days of multi-touch data misread by stakeholders | `first_seen_before_launch` flag in payload; caveat delivered to Taylor + Maren **before** the first report (spec §6) |
| Returning-visitor rate jumps at cutover and reads as growth | Pre-brief: it's measurement correcting, not growth |
| Key rotation slips | Paul + COO co-own; scheduled for cutover day, not "after" |
| Reach outage during submits | By design: browser always gets 204; dead_letters + replay |
