// Validation + bot signals. Bots are FLAGGED, never dropped (spec §8):
// no real lead is ever silently eaten; Reach ETL applies the threshold.

export const MAX_BODY_BYTES = 32 * 1024;
const MAX_VALUE_LEN = 1024;
const KEY_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[A-Za-z]{2,24}$/;

// Known crawlers / preview fetchers that otherwise mint cookies and pollute
// channel counts (spec §4: AdsBot-Google-Mobile, link previews, etc.).
const BOT_UA_RE =
  /bot|crawler|spider|crawling|headless|lighthouse|pingdom|uptime|monitor|preview|facebookexternalhit|slackbot|linkedinbot|twitterbot|whatsapp|telegram|discordbot|adsbot|googlebot|bingbot|duckduckbot|yandex|baiduspider|gptbot|claudebot|perplexitybot|ccbot|bytespider|petalbot|semrush|ahrefs|mj12bot|dotbot|applebot/i;

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "yopmail.com",
  "tempmail.com",
  "temp-mail.org",
  "throwawaymail.com",
  "sharklasers.com",
  "getnada.com",
  "trashmail.com",
  "maildrop.cc",
  "dispostable.com",
]);

export function isBotUA(ua: string | null): boolean {
  return !!ua && BOT_UA_RE.test(ua);
}

export function isValidEmail(email: unknown): email is string {
  return typeof email === "string" && EMAIL_RE.test(email);
}

export function isDisposableEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return !!domain && DISPOSABLE_EMAIL_DOMAINS.has(domain);
}

/**
 * Bot score for form events, 0–1. Signals (spec §4 /e/collect step 3):
 * honeypot website_url filled (+0.6), form_age_ms < 2000 (+0.3),
 * disposable email domain (+0.3). Capped at 1.
 */
export function botScore(fields: Record<string, unknown>, email: string | null): number {
  let score = 0;
  const honeypot = fields["website_url"];
  if (typeof honeypot === "string" && honeypot.trim().length > 0) score += 0.6;
  const age = Number(fields["form_age_ms"]);
  if (Number.isFinite(age) && age >= 0 && age < 2000) score += 0.3;
  if (email && isDisposableEmail(email)) score += 0.3;
  return Math.min(1, Math.round(score * 100) / 100);
}

/**
 * Sanitize an incoming payload: keep string/number/boolean values under
 * allowlisted-shape keys, cap lengths. Unknown-shaped keys are dropped, not
 * rejected — Webflow passthrough form fields are legitimate (spec §4).
 */
export function sanitizeFields(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!KEY_RE.test(k)) continue;
    if (typeof v === "string") out[k] = v.slice(0, MAX_VALUE_LEN);
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return out;
}

/** Same-origin gate: reject only on an explicit foreign Origin/Referer. */
export function isAllowedOrigin(req: Request, extraAllowed: string[] = []): boolean {
  const allowed = new Set(
    ["popfly.com", "www.popfly.com", "app.popfly.com", "guide.popfly.com", "localhost", "127.0.0.1", ...extraAllowed]
  );
  for (const header of ["origin", "referer"]) {
    const value = req.headers.get(header);
    if (!value) continue;
    try {
      return allowed.has(new URL(value).hostname.toLowerCase());
    } catch {
      return false;
    }
  }
  return true; // absent headers: accept (privacy browsers strip them) and rely on bot flags
}

// Best-effort per-isolate token bucket (~10/min per IP). Workers isolates are
// ephemeral so this is a soft limit; the hard protections are the origin gate,
// body cap, and bot flags.
const buckets = new Map<string, number[]>();
export function rateLimited(ip: string, limit = 10, windowMs = 60_000, now = Date.now()): boolean {
  const hits = (buckets.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(ip, hits);
    return true;
  }
  hits.push(now);
  buckets.set(ip, hits);
  if (buckets.size > 10_000) buckets.clear(); // crude memory guard
  return false;
}
