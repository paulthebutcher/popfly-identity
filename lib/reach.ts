// Reach forwarder: retry x3 with backoff, dead-letter + alert on terminal
// failure (spec §4 /e/collect step 7). The caller responds 204 to the browser
// BEFORE this runs (via ctx.waitUntil) — a Reach outage never blocks a submit.
import type { Env } from "./db";

const BACKOFF_MS = [500, 2000, 8000];

export type DeliveryResult = {
  ok: boolean;
  error: string;
  attempts: number;
};

/** Deliver once with bounded retries, without creating a dead-letter row. */
export async function deliverToReach(
  env: Env,
  payload: Record<string, unknown>
): Promise<DeliveryResult> {
  const url = `${env.REACH_WEBHOOK_URL}${env.REACH_WEBHOOK_URL.includes("?") ? "&" : "?"}key=${encodeURIComponent(env.REACH_WEBHOOK_KEY)}`;
  let lastError = "";
  let attempts = 0;
  for (let attempt = 0; attempt < BACKOFF_MS.length; attempt++) {
    attempts++;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) return { ok: true, error: "", attempts };
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
  return { ok: false, error: lastError || "unknown delivery failure", attempts };
}

export async function forwardToReach(
  env: Env,
  db: D1Database,
  payload: Record<string, unknown>,
  eventId: string | null
): Promise<boolean> {
  const result = await deliverToReach(env, payload);
  if (result.ok) return true;

  await db
    .prepare("INSERT INTO dead_letters (event_id, payload, error, attempts) VALUES (?1, ?2, ?3, ?4)")
    .bind(eventId, JSON.stringify(payload), result.error, result.attempts)
    .run();
  await alert(env, `Reach forward failed terminally (${result.error}); event dead-lettered`, eventId);
  return false;
}

/**
 * Replay unrecovered leads during the authenticated nightly maintenance run.
 * Stop at the first still-failing row so an outage cannot consume the whole
 * request window; the next run resumes from the same oldest row.
 */
export async function replayDeadLetters(env: Env, db: D1Database, limit = 25) {
  const rows = (
    await db
      .prepare("SELECT id, payload FROM dead_letters WHERE replayed_at IS NULL ORDER BY id ASC LIMIT ?1")
      .bind(limit)
      .all<{ id: number; payload: string }>()
  ).results;
  let replayed = 0;
  for (const row of rows) {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      await db
        .prepare("UPDATE dead_letters SET error = ?1 WHERE id = ?2")
        .bind("Replay failed: stored payload is invalid JSON", row.id)
        .run();
      break;
    }
    const result = await deliverToReach(env, payload);
    if (!result.ok) {
      await db
        .prepare("UPDATE dead_letters SET error = ?1, attempts = attempts + ?2 WHERE id = ?3")
        .bind(`Replay failed: ${result.error}`, result.attempts, row.id)
        .run();
      break;
    }
    await db
      .prepare("UPDATE dead_letters SET replayed_at = datetime('now'), error = NULL, attempts = attempts + ?1 WHERE id = ?2")
      .bind(result.attempts, row.id)
      .run();
    replayed++;
  }
  return { pending: rows.length, replayed };
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
