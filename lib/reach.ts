// Reach forwarder: retry x3 with backoff, dead-letter + alert on terminal
// failure (spec §4 /e/collect step 7). The caller responds 204 to the browser
// BEFORE this runs (via ctx.waitUntil) — a Reach outage never blocks a submit.
import type { Env } from "./db";

const BACKOFF_MS = [500, 2000, 8000];

export async function forwardToReach(
  env: Env,
  db: D1Database,
  payload: Record<string, unknown>,
  eventId: string | null
): Promise<boolean> {
  const url = `${env.REACH_WEBHOOK_URL}${env.REACH_WEBHOOK_URL.includes("?") ? "&" : "?"}key=${encodeURIComponent(env.REACH_WEBHOOK_KEY)}`;
  let lastError = "";
  for (let attempt = 0; attempt < BACKOFF_MS.length; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) return true;
      lastError = `HTTP ${res.status}`;
      // 4xx (other than 429) won't improve on retry.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt < BACKOFF_MS.length - 1) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
    }
  }

  await db
    .prepare("INSERT INTO dead_letters (event_id, payload, error, attempts) VALUES (?1, ?2, ?3, ?4)")
    .bind(eventId, JSON.stringify(payload), lastError, BACKOFF_MS.length)
    .run();
  await alert(env, `Reach forward failed terminally (${lastError}); event dead-lettered`, eventId);
  return false;
}

export async function alert(env: Env, message: string, eventId: string | null = null): Promise<void> {
  if (!env.ALERT_WEBHOOK_URL) return;
  try {
    await fetch(env.ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ service: "popfly-identity", message, event_id: eventId, ts: new Date().toISOString() }),
    });
  } catch {
    // Alerting must never take the request down with it.
  }
}
