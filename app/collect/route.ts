// POST /e/collect — form-event ingest, forward to Reach (spec §4).
// The browser ALWAYS gets 204 fast: the Reach forward runs in ctx.waitUntil
// after the response, so a Reach outage never blocks a visitor's submit.
import { cloudflare, sha256Hex, type TouchRow } from "@/lib/db";
import { forwardToReach } from "@/lib/reach";
import {
  botScore, isAllowedOrigin, isBotUA, isValidEmail,
  MAX_BODY_BYTES, rateLimited, sanitizeFields,
} from "@/lib/validate";

export const dynamic = "force-dynamic";

const TOUCH_HISTORY_CAP = 50;

export async function POST(req: Request): Promise<Response> {
  const { env, ctx, cf } = cloudflare();
  const db = env.DB;

  // --- Gate (spec §4 step 1): origin, size, rate. sendBeacon arrives as
  // text/plain, so parse the raw text as JSON regardless of content-type.
  if (!isAllowedOrigin(req)) return new Response(null, { status: 403 });
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  if (rateLimited(ip)) return new Response(null, { status: 429 });

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return new Response(null, { status: 413 });

  let fields: Record<string, unknown>;
  try {
    fields = sanitizeFields(JSON.parse(raw));
  } catch {
    return new Response(null, { status: 400 });
  }

  // --- Validate (step 2): email is the one hard requirement.
  const email = typeof fields.email === "string" ? fields.email.trim().toLowerCase() : null;
  if (!isValidEmail(email)) return new Response(null, { status: 422 });

  // --- Bot signals (step 3): flag, never drop.
  const score = botScore(fields, email);
  const uaBot = isBotUA(req.headers.get("user-agent"));

  // --- Identity merge (step 4): cookie is authoritative; a divergent client
  // ID rides along so Reach can stitch pre-migration history.
  const cookieVid = readCookie(req.headers.get("cookie"), "pf_vid");
  const clientVid = typeof fields.visitor_id === "string" ? fields.visitor_id : null;
  const visitorId = cookieVid ?? clientVid ?? `v_${crypto.randomUUID()}`;
  const visitorIdClient = clientVid && clientVid !== visitorId ? clientVid : null;
  const sessionId = typeof fields.session_id === "string" ? fields.session_id : null;

  // --- Enrich (step 5).
  const receivedAt = new Date().toISOString();
  const eventId = await sha256Hex(`${email}|${sessionId ?? ""}|${Math.floor(Date.now() / 60_000)}`);

  // --- Attach touch history (step 6): the FIRST touch plus the most recent
  // 49, so first_touch and last_touch are both truly what they claim even
  // for visitors with more than 50 touches. touch_count reports the real
  // total, which may exceed the array length.
  let touches: TouchRow[] = [];
  let touchTotal = 0;
  let firstSeenAt: string | null = null;
  let sessionCount = 0;
  try {
    const vids = visitorIdClient ? [visitorId, visitorIdClient] : [visitorId];
    const placeholders = vids.map((_, i) => `?${i + 1}`).join(", ");
    const recent = (
      await db
        .prepare(`SELECT * FROM touches WHERE visitor_id IN (${placeholders}) ORDER BY id DESC LIMIT ${TOUCH_HISTORY_CAP - 1}`)
        .bind(...vids)
        .all<TouchRow>()
    ).results.reverse();
    const firstTouch = await db
      .prepare(`SELECT * FROM touches WHERE visitor_id IN (${placeholders}) ORDER BY id ASC LIMIT 1`)
      .bind(...vids)
      .first<TouchRow>();
    touches = firstTouch && !recent.some((r) => r.id === firstTouch.id) ? [firstTouch, ...recent] : recent;
    const stats = await db
      .prepare(
        `SELECT MIN(ts) AS first_seen, COUNT(DISTINCT session_id) AS sessions,
                (SELECT COUNT(*) FROM touches WHERE visitor_id IN (${placeholders})) AS touch_total
           FROM pageviews WHERE visitor_id IN (${placeholders})`
      )
      .bind(...vids)
      .first<{ first_seen: string | null; sessions: number; touch_total: number }>();
    firstSeenAt = stats?.first_seen ?? null;
    sessionCount = stats?.sessions ?? 0;
    touchTotal = stats?.touch_total ?? touches.length;
  } catch {
    // History enrichment is best-effort; the lead still ships.
  }

  const launchTs = env.LAUNCH_TS ? Date.parse(env.LAUNCH_TS) : NaN;
  const firstSeenBeforeLaunch =
    !!firstSeenAt && Number.isFinite(launchTs) && Date.parse(firstSeenAt.replace(" ", "T") + "Z") < launchTs;

  const touchHistory = touches.map((t, i) => ({
    ts: t.ts,
    channel: t.channel,
    source: t.source,
    medium: t.medium,
    campaign: t.campaign,
    landing_page: t.landing_page,
    referrer: t.referrer,
    touch_index: t.touch_index ?? i + 1,
    rules_version: t.rules_version,
  }));
  const first = touchHistory[0] ?? null;
  const last = touchHistory[touchHistory.length - 1] ?? null;

  const payload: Record<string, unknown> = {
    ...fields, // passthrough form fields + flat first-touch fields from the script
    email,
    visitor_id: visitorId,
    ...(visitorIdClient ? { visitor_id_client: visitorIdClient } : {}),
    session_id: sessionId,
    touches: touchHistory,
    first_touch_channel: first?.channel ?? null,
    last_touch_channel: last?.channel ?? null,
    touch_count: touchTotal || touchHistory.length,
    session_count: sessionCount,
    first_seen_at: firstSeenAt,
    first_seen_before_launch: firstSeenBeforeLaunch,
    bot_score: score,
    is_bot_ua: uaBot,
    geo_city: cf?.city ?? null,
    geo_country: cf?.country ?? null,
    event_id: eventId,
    received_at: receivedAt,
    conversion_page: fields.conversion_page ?? null,
    source: fields.source === "identity_endpoint_test" ? "identity_endpoint_test" : "identity_endpoint",
  };

  // --- Forward (step 7) after the response is on the wire.
  ctx.waitUntil(forwardToReach(env, db, payload, eventId));

  return new Response(null, { status: 204 });
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=") || null;
  }
  return null;
}
