# Phase 0b — RB2B DevTools Checklist (~10 min)

Goal: determine whether RB2B exposes a **readable client-side identifier** on popfly.com. Outcome decides whether the RB2B join is a hard key (`rb2b_id` passed through `/e/v`) or a fuzzy match (timestamp + URL + city) with an accepted mismatch rate. This log is the only channel source for RB2B-identified non-converters (spec §3), so it's worth the 10 minutes.

Run in a regular (non-private) window on `www.popfly.com` with ad blockers off:

1. **Cookies.** DevTools → Application → Cookies → both `www.popfly.com` and any RB2B domain. Look for RB2B-set cookies (names often contain `rb2b`, `_rb`, or an opaque UUID set by the RB2B script's domain). Note name, value shape, and whether it's on the first-party domain (readable by our script) or third-party (not readable).
2. **Storage.** Application → Local Storage and Session Storage for `www.popfly.com`. Search for `rb2b` or UUID-shaped values written around page load.
3. **Globals.** Console: type `window.` and inspect for RB2B objects (try `window.reb2b`, `window.rb2b`, `Object.keys(window).filter(k => /rb/i.test(k))`). If an object exists, expand it for an ID/visitor/session field.
4. **Network.** Network tab, filter by the RB2B script host. Inspect outgoing beacon payloads and responses for a visitor/device ID. An ID that only ever appears in *their* network traffic (never persisted where JS can read it) does NOT count — we can't capture it.
5. **Persistence check.** Reload the page and repeat 1–3: does the same value reappear? An ID that rotates per pageload is useless as a join key; it must be stable at least per browser.

**Record the outcome in [DECISIONS.md](DECISIONS.md):**
- Found + stable + first-party readable → hard key. Note exactly where it lives (cookie name / storage key / global path) so script v2.2 step 5 reads the right thing.
- Nothing readable or unstable → fuzzy-join fallback accepted in writing; drop `rb2b_id` from the `/e/v` body and payload contract.
