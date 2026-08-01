// Classifier tests — Build Plan step 1a exit criteria:
// all 13 rules covered; android-app:// mapped; all four owned domains
// suppress; gclid-without-UTM → paid_search never direct; unknown ≠ direct;
// RULES_VERSION stamped. Referrers are the PRODUCTION list from spec §3.
import { describe, expect, it } from "vitest";
import { classify, OWNED_DOMAINS, RULES_VERSION } from "../lib/classify";

const none = {};
const from = (referrer: string | null, params: Record<string, string> = none) =>
  classify({ params, referrer });

describe("rule order: click IDs before UTMs", () => {
  it("gclid with NO utm params → paid_search/google, never direct (rule 1)", () => {
    const c = from(null, { gclid: "abc123" });
    expect(c.channel).toBe("paid_search");
    expect(c.source).toBe("google");
    expect(c.rule).toBe(1);
  });
  it("gad_source and gad_campaignid also hit rule 1", () => {
    expect(from(null, { gad_source: "1" }).channel).toBe("paid_search");
    expect(from(null, { gad_campaignid: "999" }).channel).toBe("paid_search");
  });
  it("gclid wins even when UTMs are also present", () => {
    const c = from(null, { gclid: "x", utm_source: "newsletter", utm_medium: "email" });
    expect(c.channel).toBe("paid_search");
    expect(c.rule).toBe(1);
  });
  it("msclkid → paid_search/bing (rule 2)", () => {
    const c = from(null, { msclkid: "m1" });
    expect(c).toMatchObject({ channel: "paid_search", source: "bing", rule: 2 });
  });
  it("li_fat_id → paid_social/linkedin (rule 3)", () => {
    expect(from(null, { li_fat_id: "l1" })).toMatchObject({ channel: "paid_social", source: "linkedin", rule: 3 });
  });
  it("grsf → referral_program/growsurf (rule 4)", () => {
    expect(from(null, { grsf: "g1" })).toMatchObject({ channel: "referral_program", source: "growsurf", rule: 4 });
  });
});

describe("UTM rules 5-6", () => {
  it("paid mediums map to paid buckets (rule 5)", () => {
    expect(from(null, { utm_source: "google", utm_medium: "cpc" }).channel).toBe("paid_search");
    expect(from(null, { utm_source: "meta", utm_medium: "paidsocial" }).channel).toBe("paid_social");
    expect(from(null, { utm_source: "gdn", utm_medium: "display" }).channel).toBe("paid_display");
  });
  it("recognized organic taxonomy maps (rule 6)", () => {
    expect(from(null, { utm_source: "substack", utm_medium: "email" }).channel).toBe("email");
    expect(from(null, { utm_source: "linkedin", utm_medium: "social" }).channel).toBe("organic_social");
  });
  it("present-but-unrecognized UTMs → referral, not unknown (rule 6 fallback)", () => {
    const c = from(null, { utm_source: "partnerx", utm_medium: "partnership" });
    expect(c.channel).toBe("referral");
    expect(c.rule).toBe(6);
  });
  it("utm_campaign is carried through", () => {
    expect(from(null, { utm_source: "google", utm_medium: "cpc", utm_campaign: "spring" }).campaign).toBe("spring");
  });
});

describe("production referrer list (spec §3, RB2B export)", () => {
  const cases: Array<[string, string, string]> = [
    ["https://www.google.com/", "organic_search", "google"],
    ["https://google.com/", "organic_search", "google"],
    ["https://www.bing.com/", "organic_search", "bing"],
    ["https://duckduckgo.com/", "organic_search", "duckduckgo"],
    ["https://search.yahoo.com/", "organic_search", "yahoo"],
    ["https://l.threads.com/", "organic_social", "threads"],
    ["https://www.facebook.com/", "organic_social", "facebook"],
    ["https://www.linkedin.com/", "organic_social", "linkedin"],
    ["https://www.instagram.com/", "organic_social", "instagram"],
    ["https://chatgpt.com/", "ai_referral", "chatgpt"],
    ["https://substack.com/", "referral", "substack.com"],
  ];
  it.each(cases)("%s → %s / %s", (referrer, channel, source) => {
    const c = from(referrer);
    expect(c.channel).toBe(channel);
    expect(c.source).toBe(source);
  });
});

describe("android-app:// scheme (spec §4: must never fall to unknown)", () => {
  it("gmail app → email", () => {
    expect(from("android-app://com.google.android.gm")).toMatchObject({ channel: "email", source: "gmail" });
  });
  it("linkedin app → organic_social", () => {
    expect(from("android-app://com.linkedin.android")).toMatchObject({ channel: "organic_social", source: "linkedin" });
  });
  it("google quicksearch → organic_search", () => {
    expect(from("android-app://com.google.android.googlequicksearchbox")).toMatchObject({
      channel: "organic_search",
      source: "google",
    });
  });
  it("unknown android app → referral with package as source, not unknown", () => {
    const c = from("android-app://com.example.app");
    expect(c.channel).toBe("referral");
    expect(c.channel).not.toBe("unknown");
  });
});

describe("owned domains (rule 10) — all four suppress", () => {
  it.each([...OWNED_DOMAINS])("%s → internal", (host) => {
    expect(from(`https://${host}/some/page`).channel).toBe("internal");
  });
});

describe("AI surfaces vs Google search disambiguation", () => {
  it("gemini.google.com is ai_referral, NOT organic_search (rule 9)", () => {
    const c = from("https://gemini.google.com/");
    expect(c.channel).toBe("ai_referral");
    expect(c.source).toBe("gemini");
  });
  it("google ccTLDs still classify as search", () => {
    expect(from("https://www.google.co.uk/").channel).toBe("organic_search");
    expect(from("https://google.de/").channel).toBe("organic_search");
  });
});

describe("rules 11-13: referral / direct / unknown stay distinct", () => {
  it("unmatched external referrer → referral (rule 11)", () => {
    const c = from("https://someblog.example.com/post");
    expect(c).toMatchObject({ channel: "referral", rule: 11 });
  });
  it("no referrer, no params → direct (rule 12)", () => {
    expect(from(null)).toMatchObject({ channel: "direct", rule: 12 });
  });
  it("garbage referrer → unknown, never direct (rule 13)", () => {
    const c = from("not a url at all");
    expect(c.channel).toBe("unknown");
    expect(c.rule).toBe(13);
  });
  it("unknown and direct are distinct channels", () => {
    expect(from("::::")).not.toMatchObject({ channel: "direct" });
  });
});

describe("RULES_VERSION", () => {
  it("is a positive integer, stamped on every touches write", () => {
    expect(Number.isInteger(RULES_VERSION)).toBe(true);
    expect(RULES_VERSION).toBeGreaterThan(0);
  });
});
