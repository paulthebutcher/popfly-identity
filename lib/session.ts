// Server-side session derivation (spec §4 /e/v step 4, §8).
// The server owns session boundaries: reuse the visitor's last session if its
// most recent event is under 30 minutes old, else mint. The client's
// sessionStorage value is a hint only — trusting it double-counted sessions
// across tabs in v3.1.

export const SESSION_WINDOW_MS = 30 * 60 * 1000;

const HINT_RE = /^sess_[A-Za-z0-9-]{8,64}$/;

export async function deriveSession(
  db: D1Database,
  visitorId: string,
  hint: string | null | undefined,
  now: Date = new Date()
): Promise<{ sessionId: string; isNew: boolean }> {
  const last = await db
    .prepare("SELECT session_id, ts FROM pageviews WHERE visitor_id = ?1 ORDER BY id DESC LIMIT 1")
    .bind(visitorId)
    .first<{ session_id: string; ts: string }>();

  if (last?.session_id && last.ts) {
    const lastMs = Date.parse(last.ts.replace(" ", "T") + (last.ts.includes("Z") ? "" : "Z"));
    if (!Number.isNaN(lastMs) && now.getTime() - lastMs < SESSION_WINDOW_MS) {
      return { sessionId: last.session_id, isNew: false };
    }
  }
  // No recent server-side activity: a well-formed client hint is acceptable
  // for continuity (first request of a deploy, D1 pruned, etc.), else mint.
  if (hint && HINT_RE.test(hint) && !last) {
    return { sessionId: hint, isNew: true };
  }
  return { sessionId: `sess_${crypto.randomUUID()}`, isNew: true };
}
