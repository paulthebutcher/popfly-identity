// POST /e/v — identify + touch + pageview, one roundtrip per pageload (spec §4).
// Fire-and-forget from the head script; must never break a pageview, so all
// failures degrade to a 200 with whatever IDs we could produce.
import { classify, referrerHost, RULES_VERSION } from "@/lib/classify";
import { cloudflare, sha256Hex } from "@/lib/db";
import { deriveSession } from "@/lib/session";
import { isAllowedOrigin, isBotUA, sanitizeFields } from "@/lib/validate";

export const dynamic = "force-dynamic";

const COOKIE_NAME = "pf_vid";
const COOKIE_MAX_AGE = 34_560_000; // 400 days — the Chrome cap; rolling
const VID_RE = /^v_[A-Za-z0-9-]{8,64}$/;

// Attribution params the script forwards; anything else is ignored here.
const ATTRIBUTION_KEYS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "gclid", "gad_source", "gad_campaignid", "msclkid", "li_fat_id", "fbclid", "grsf",
];

export async function POST(req: Request): Promise<Response> {
  const { env, cf } = cloudflare();
  const db = env.DB;

  let body: Record<string, unknown> = {};
  try {
    body = sanitizeFields(await req.json());
  } catch {
    // fire-and-forget caller; proceed with empty body
  }

  if (!isAllowedOrigin(req)) {
    return new Response(null, { status: 403 });
  }

  const isBot = isBotUA(req.headers.get("user-agent")) ? 1 : 0; // flag, never drop

  // --- Identity: cookie is authoritative; mint if missing.
  const cookieVid = readCookie(req.headers.get("cookie"), COOKIE_NAME);
  const visitorId = cookieVid && VID_RE.test(cookieVid) ? cookieVid : `v_${crypto.randomUUID()}`;

  // --- Session: server-derived; client value is a hint only.
  const hint = typeof body.session_hint === "string" ? body.session_hint : null;
  const { sessionId, isNew: isNewSession } = await deriveSession(db, visitorId, hint);

  // --- Parse the page URL and pick out attribution params.
  const rawUrl = typeof body.url === "string" ? body.url : "";
  let path: string | null = null;
  let query: string | null = null;
  const params: Record<string, string> = {};
  try {
    const u = new URL(rawUrl);
    path = u.pathname || "/";
    query = u.search ? u.search.slice(1) : null;
    for (const key of ATTRIBUTION_KEYS) {
      const v = u.searchParams.get(key);
      if (v) params[key] = v;
    }
  } catch {
    path = null;
  }

  const referrer = typeof body.referrer === "string" && body.referrer ? body.referrer : null;
  const rb2bId = typeof body.rb2b_id === "string" ? body.rb2b_id.slice(0, 64) : null;
  const geoCity = cf?.city ?? null;
  const geoCountry = cf?.country ?? null;

  // --- Classify, then decide whether this is an attribution touch (spec §4):
  // channel != internal AND (new session OR attribution param OR external
  // referrer) AND dedup_key fresh. Plain internal navigation → pageview only.
  const c = classify({ params, referrer });
  const host = referrerHost(referrer);
  const externalReferrer = !!host && c.channel !== "internal";
  const isTouch = c.channel !== "internal" && (isNewSession || Object.keys(params).length > 0 || externalReferrer);

  let touchId: number | null = null;
  try {
    if (isTouch) {
      const bucket = Math.floor(Date.now() / (30 * 60 * 1000));
      const dedupKey = await sha256Hex(`${visitorId}|${JSON.stringify(params)}|${host ?? ""}|${bucket}`);
      const inserted = await db
        .prepare(
          `INSERT OR IGNORE INTO touches
             (visitor_id, session_id, landing_page, landing_url_raw, referrer, referrer_host,
              params, channel, source, medium, campaign, touch_index, rules_version, is_bot,
              geo_city, geo_country, rb2b_id, dedup_key)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                   (SELECT COUNT(*) + 1 FROM touches WHERE visitor_id = ?1),
                   ?12, ?13, ?14, ?15, ?16, ?17)`
        )
        .bind(
          visitorId, sessionId, path, rawUrl.slice(0, 2048) || null, referrer, host,
          Object.keys(params).length ? JSON.stringify(params) : null,
          c.channel, c.source, c.medium, c.campaign,
          RULES_VERSION, isBot, geoCity, geoCountry, rb2bId, dedupKey
        )
        .run();
      touchId = inserted.meta.changes > 0 ? inserted.meta.last_row_id : null;
    }

    // --- Always write a pageview (spec §4 step 5).
    if (path) {
      await db
        .prepare(
          `INSERT INTO pageviews (visitor_id, session_id, path, query, referrer, touch_id, is_bot, geo_city, geo_country)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
        )
        .bind(visitorId, sessionId, path, query, referrer, touchId, isBot, geoCity, geoCountry)
        .run();
    }
  } catch {
    // Never fail the page over a write error; the response below still
    // carries IDs so the script converges on the durable cookie.
  }

  const headers = new Headers({
    "content-type": "application/json",
    "cache-control": "no-store",
    "set-cookie": buildCookie(req, visitorId),
  });
  return new Response(
    JSON.stringify({ visitor_id: visitorId, session_id: sessionId, channel: c.channel }),
    { status: 200, headers }
  );
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=") || null;
  }
  return null;
}

function buildCookie(req: Request, value: string): string {
  // Domain=.popfly.com so app/guide subdomains read the ID later (spec §8);
  // host-only in local dev where that domain would be rejected.
  const host = new URL(req.url).hostname;
  const domain = host.endsWith("popfly.com") ? "; Domain=.popfly.com" : "";
  return `${COOKIE_NAME}=${value}${domain}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
}
