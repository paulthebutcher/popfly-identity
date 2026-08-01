// D1 access via the OpenNext Cloudflare context. Bindings and secrets are
// only ever touched inside request handlers (spec §4).
import { getCloudflareContext } from "@opennextjs/cloudflare";

export type Env = {
  DB: D1Database;
  REACH_WEBHOOK_URL: string;
  REACH_WEBHOOK_KEY: string;
  ALERT_WEBHOOK_URL?: string;
  PUSH_KEY: string;
  LAUNCH_TS?: string; // ISO timestamp of cutover; powers first_seen_before_launch
};

export function cloudflare() {
  const { env, ctx, cf } = getCloudflareContext() as unknown as {
    env: Env;
    ctx: { waitUntil(p: Promise<unknown>): void };
    cf?: { city?: string; country?: string };
  };
  return { env, ctx, cf };
}

export type TouchRow = {
  id: number;
  visitor_id: string;
  session_id: string | null;
  ts: string;
  landing_page: string | null;
  landing_url_raw: string | null;
  referrer: string | null;
  referrer_host: string | null;
  params: string | null;
  channel: string;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  touch_index: number | null;
  rules_version: number;
  is_bot: number;
  geo_city: string | null;
  geo_country: string | null;
  rb2b_id: string | null;
  dedup_key: string | null;
};

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
