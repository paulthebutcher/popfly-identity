// Channel classifier — ordered rules, first match wins (spec §4).
// RULES_VERSION is stamped on every touches row so a future taxonomy change
// can reclassify exactly the affected rows. Bump it on ANY change to the
// rules, host lists, or mappings below.

export const RULES_VERSION = 1;

export type Classification = {
  channel: string;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  rule: number; // which rule (1-13) matched, for debugging
};

export type ClassifyInput = {
  params: Record<string, string>;
  referrer: string | null;
};

// Owned surfaces: referrals between these log a pageview but never a touch.
export const OWNED_DOMAINS = new Set([
  "popfly.com",
  "www.popfly.com",
  "app.popfly.com",
  "guide.popfly.com",
]);

export const AI_SURFACES = new Set([
  "chatgpt.com",
  "www.chatgpt.com",
  "perplexity.ai",
  "www.perplexity.ai",
  "claude.ai",
  "gemini.google.com",
  "copilot.microsoft.com",
]);

const SOCIAL_HOSTS = new Set([
  "facebook.com",
  "www.facebook.com",
  "l.facebook.com",
  "lm.facebook.com",
  "m.facebook.com",
  "instagram.com",
  "www.instagram.com",
  "l.instagram.com",
  "linkedin.com",
  "www.linkedin.com",
  "lnkd.in",
  "t.co",
  "twitter.com",
  "x.com",
  "threads.net",
  "www.threads.net",
  "threads.com",
  "www.threads.com",
  "l.threads.com", // seen in production (spec §3)
  "reddit.com",
  "www.reddit.com",
  "out.reddit.com",
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "pinterest.com",
  "www.pinterest.com",
  "tiktok.com",
  "www.tiktok.com",
]);

// Non-Google engines matched by exact host; Google matched by pattern below
// so gemini.google.com does NOT classify as search (it's an AI surface).
const SEARCH_HOSTS = new Set([
  "bing.com",
  "www.bing.com",
  "duckduckgo.com",
  "search.yahoo.com",
  "search.brave.com",
  "www.ecosia.org",
  "ecosia.org",
  "startpage.com",
  "www.startpage.com",
  "yandex.com",
  "yandex.ru",
  "www.baidu.com",
]);

// google.com, www.google.com, google.co.uk, www.google.de … but NOT
// subdomains like gemini.google.com or mail.google.com.
const GOOGLE_SEARCH_RE = /^(www\.)?google\.([a-z]{2,3})(\.[a-z]{2})?$/;

// android-app:// referrers: URL.hostname yields the package name (spec §4).
const ANDROID_APP_MAP: Record<string, Classification> = {
  "com.google.android.gm": { channel: "email", source: "gmail", medium: "email", campaign: null, rule: 0 },
  "com.linkedin.android": { channel: "organic_social", source: "linkedin", medium: "social", campaign: null, rule: 0 },
  "com.google.android.googlequicksearchbox": { channel: "organic_search", source: "google", medium: "organic", campaign: null, rule: 0 },
};

const PAID_MEDIUMS: Record<string, string> = {
  cpc: "paid_search",
  ppc: "paid_search",
  paid: "paid_other",
  paidsocial: "paid_social",
  "paid-social": "paid_social",
  paid_social: "paid_social",
  display: "paid_display",
};

// Rule 6 taxonomy: map recognized utm_medium/utm_source to a channel.
// Present-but-unrecognized UTMs fall through to "referral" (a tagged link we
// don't know the taxonomy for is still a deliberate link, not a data gap).
const MEDIUM_CHANNEL: Record<string, string> = {
  email: "email",
  newsletter: "email",
  social: "organic_social",
  referral: "referral",
  organic: "organic_search",
  affiliate: "referral",
  partner: "referral",
};

const SOURCE_CHANNEL: Record<string, string> = {
  google: "organic_search",
  bing: "organic_search",
  duckduckgo: "organic_search",
  facebook: "organic_social",
  instagram: "organic_social",
  linkedin: "organic_social",
  twitter: "organic_social",
  x: "organic_social",
  threads: "organic_social",
  reddit: "organic_social",
  youtube: "organic_social",
  tiktok: "organic_social",
  chatgpt: "ai_referral",
  perplexity: "ai_referral",
  substack: "referral",
};

export function referrerHost(referrer: string | null): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

function isAndroidApp(referrer: string | null): boolean {
  return !!referrer && referrer.toLowerCase().startsWith("android-app://");
}

export function classify(input: ClassifyInput): Classification {
  const p = lowerKeys(input.params);
  const host = referrerHost(input.referrer);
  const utmSource = p["utm_source"] ?? null;
  const utmMedium = p["utm_medium"] ?? null;
  const campaign = p["utm_campaign"] ?? null;

  // 1. Google Ads click IDs — MUST precede UTM checks: auto-tagged paid
  //    clicks arrive with gclid and no utm_source (spec §4 warning).
  if (p["gclid"] || p["gad_source"] || p["gad_campaignid"]) {
    return { channel: "paid_search", source: "google", medium: utmMedium ?? "cpc", campaign: campaign ?? p["gad_campaignid"] ?? null, rule: 1 };
  }
  // 2. Microsoft Ads
  if (p["msclkid"]) {
    return { channel: "paid_search", source: "bing", medium: utmMedium ?? "cpc", campaign, rule: 2 };
  }
  // 3. LinkedIn Ads
  if (p["li_fat_id"]) {
    return { channel: "paid_social", source: "linkedin", medium: utmMedium ?? "paid_social", campaign, rule: 3 };
  }
  // 4. GrowSurf referral program
  if (p["grsf"]) {
    return { channel: "referral_program", source: "growsurf", medium: "referral", campaign, rule: 4 };
  }
  // 5. Explicit paid mediums
  if (utmMedium && PAID_MEDIUMS[utmMedium]) {
    return { channel: PAID_MEDIUMS[utmMedium], source: utmSource, medium: utmMedium, campaign, rule: 5 };
  }
  // 6. Other UTMs present — map from taxonomy; unrecognized → referral.
  if (utmSource || utmMedium) {
    const channel =
      (utmMedium && MEDIUM_CHANNEL[utmMedium]) ||
      (utmSource && SOURCE_CHANNEL[utmSource]) ||
      "referral";
    return { channel, source: utmSource, medium: utmMedium, campaign, rule: 6 };
  }

  // android-app:// scheme — mapped before host lists; a https:// regex would
  // silently drop these into unknown (spec §4).
  if (isAndroidApp(input.referrer)) {
    const mapped = host ? ANDROID_APP_MAP[host] : undefined;
    if (mapped) return { ...mapped, campaign, rule: 7 };
    return { channel: "referral", source: host, medium: "app", campaign, rule: 11 };
  }

  // 7. Search engines
  if (host && (SEARCH_HOSTS.has(host) || GOOGLE_SEARCH_RE.test(host))) {
    const source = GOOGLE_SEARCH_RE.test(host) ? "google" : host.replace(/^(www\.|search\.)/, "").split(".")[0];
    return { channel: "organic_search", source, medium: "organic", campaign, rule: 7 };
  }
  // 8. Social
  if (host && SOCIAL_HOSTS.has(host)) {
    const source = host.replace(/^(www\.|l\.|lm\.|m\.|out\.)/, "").split(".")[0];
    return { channel: "organic_social", source, medium: "social", campaign, rule: 8 };
  }
  // 9. AI surfaces — own bucket: the trend line is the point (spec §4).
  if (host && AI_SURFACES.has(host)) {
    const source = host === "gemini.google.com" ? "gemini" : host.replace(/^www\./, "").split(".")[0];
    return { channel: "ai_referral", source, medium: "referral", campaign, rule: 9 };
  }
  // 10. Owned domains → internal; caller suppresses the touch.
  if (host && OWNED_DOMAINS.has(host)) {
    return { channel: "internal", source: host, medium: null, campaign, rule: 10 };
  }
  // 11. Some other external referrer
  if (host) {
    return { channel: "referral", source: host, medium: "referral", campaign, rule: 11 };
  }
  // 11b. Bare fbclid with no referrer: Facebook's in-app browser strips the
  // referrer, and fbclid rides on ALL FB outbound clicks (organic included —
  // which is why it is deliberately NOT a paid-click rule up top). Without
  // this, FB in-app traffic inflates `unknown` and degrades the hygiene alarm.
  if (p["fbclid"]) {
    return { channel: "organic_social", source: "facebook", medium: "social", campaign, rule: 14 };
  }
  // 12. No referrer, no params — real direct behavior.
  if (Object.keys(p).length === 0 && !input.referrer) {
    return { channel: "direct", source: null, medium: null, campaign: null, rule: 12 };
  }
  // 13. Something present but unparseable — a data gap, NOT direct.
  //     Rising unknown share is the campaign-hygiene alarm (spec §4).
  return { channel: "unknown", source: null, medium: utmMedium, campaign, rule: 13 };
}

function lowerKeys(obj: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && v.length > 0) out[k.toLowerCase()] = v.toLowerCase();
  }
  return out;
}
