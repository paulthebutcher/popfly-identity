// GET /e/dev-harness — local/staging test page mimicking head script v2.2.
// Served from the SAME ORIGIN as the endpoints, so cookies, the origin gate,
// and sendBeacon-style posts behave exactly as they will on popfly.com.
// Hard-gated: returns 404 unless env DEV_HARNESS === "1" (set in .dev.vars;
// never set in the Webflow Cloud dashboard).
import { cloudflare } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const { env } = cloudflare();
  if ((env as { DEV_HARNESS?: string }).DEV_HARNESS !== "1") {
    return new Response(null, { status: 404 });
  }
  return new Response(HTML, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

const HTML = /* html */ `<!doctype html>
<meta charset="utf-8">
<title>popfly-identity dev harness</title>
<style>
  body{font:14px/1.5 ui-monospace,monospace;max-width:720px;margin:2rem auto;padding:0 1rem}
  fieldset{margin:1rem 0;border:1px solid #999;border-radius:6px}
  button{margin:.2rem .3rem .2rem 0;padding:.35rem .7rem;cursor:pointer}
  pre{background:#f4f4f4;padding: .75rem;border-radius:6px;overflow-x:auto;white-space:pre-wrap}
  input{width:100%;box-sizing:border-box;margin:.15rem 0;padding:.3rem}
  .hp{position:absolute;left:-9999px}
</style>
<h1>identity dev harness</h1>
<p>Mimics head script v2.2 against this same origin. State: <span id="state">idle</span></p>

<fieldset><legend>1 — /e/v journeys (fires like the head script)</legend>
  <button onclick="visit('https://www.popfly.com/pets?gclid=test-'+Date.now(), 'https://www.google.com/')">paid click (gclid)</button>
  <button onclick="visit('https://www.popfly.com/creators', 'https://duckduckgo.com/')">organic search</button>
  <button onclick="visit('https://www.popfly.com/', 'https://l.threads.com/')">threads social</button>
  <button onclick="visit('https://www.popfly.com/platform', 'https://chatgpt.com/')">ai referral</button>
  <button onclick="visit('https://www.popfly.com/start/new', 'https://www.popfly.com/pets')">internal nav</button>
  <button onclick="visit('https://www.popfly.com/', '')">direct</button>
  <button onclick="visit('https://www.popfly.com/blog', 'android-app://com.linkedin.android')">android linkedin app</button>
</fieldset>

<fieldset><legend>2 — /e/collect form (sendBeacon-style: text/plain)</legend>
  <form id="f" onsubmit="return submitForm(event)">
    <input name="email" placeholder="email" value="harness-test@example.com">
    <input name="name" placeholder="name" value="Harness Tester">
    <input class="hp" name="website_url" tabindex="-1" autocomplete="off">
    <button>submit → /e/collect</button>
  </form>
  <label><input type="checkbox" id="fast" style="width:auto"> simulate bot (instant submit + honeypot)</label>
</fieldset>

<fieldset><legend>log</legend><pre id="log">—</pre></fieldset>

<script>
  const t0 = Date.now();
  const logEl = document.getElementById("log");
  const log = (label, data) => {
    logEl.textContent = "[" + new Date().toISOString().slice(11,19) + "] " + label + "\\n" +
      (typeof data === "string" ? data : JSON.stringify(data, null, 2)) + "\\n\\n" + logEl.textContent;
  };
  let lastIds = {};

  async function visit(url, referrer) {
    document.getElementById("state").textContent = "posting /e/v…";
    const body = {
      url, referrer,
      session_hint: sessionStorage.getItem("pf_session") || null,
      rb2b_id: localStorage.getItem("_reb2buid") || "87a732db-harness-test",
    };
    const res = await fetch("/e/v", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(body) });
    const json = await res.json();
    lastIds = json;
    sessionStorage.setItem("pf_session", json.session_id);
    localStorage.setItem("_pf_visitor_id", json.visitor_id); // script v2.2 write-through
    document.getElementById("state").textContent = "ok";
    log("POST /e/v ← " + url + "  (ref: " + (referrer || "none") + ")", json);
  }

  function submitForm(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    const bot = document.getElementById("fast").checked;
    const payload = {
      email: f.get("email"), name: f.get("name"),
      website_url: bot ? "https://spam.example" : f.get("website_url"),
      form_age_ms: bot ? 350 : Date.now() - t0,
      form_id: "dev-harness",
      visitor_id: localStorage.getItem("_pf_visitor_id"),
      session_id: sessionStorage.getItem("pf_session"),
      source: "identity_endpoint_test",
      conversion_page: "/e/dev-harness",
    };
    fetch("/e/collect", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(payload), keepalive: true })
      .then(r => log("POST /e/collect → HTTP " + r.status + (bot ? "  (bot simulation)" : ""), payload));
    return false;
  }
</script>`;
