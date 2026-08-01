// POST /e/push — scheduled batch push to Reach + retention maintenance.
// Replaces the spec's GET /e/export (0c closed Aug 1 2026: Reach can't pull).
// Triggered nightly by .github/workflows/nightly-push.yml (Webflow Cloud has
// no documented cron support — 0f re-verifies at first staging deploy).
// Idempotent: high-water marks advance only after Reach confirms a batch, so
// a partial failure re-sends rows next run and Reach upserts on (table, id)
// (docs/REACH.md §2).
import { cloudflare, type Env } from "@/lib/db";
import { alert } from "@/lib/reach";

export const dynamic = "force-dynamic";

const BATCH_SIZE = 500;
const MAX_BATCHES_PER_RUN = 40; // stay well inside the request timeout
const PAGEVIEW_RETENTION_DAYS = 90;
const TOUCH_RETENTION_DAYS = 400;

export async function POST(req: Request): Promise<Response> {
  const { env } = cloudflare();
  const db = env.DB;

  const auth = req.headers.get("authorization");
  if (!auth || auth !== `Bearer ${env.PUSH_KEY}`) {
    return new Response(null, { status: 401 });
  }

  const summary: Record<string, unknown> = { started_at: new Date().toISOString() };
  try {
    summary.touches = await pushTable(env, db, "touches");
    summary.pageviews = await pushTable(env, db, "pageviews");
    summary.prune = await prune(db);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await alert(env, `Nightly push failed: ${message}`);
    return Response.json({ ok: false, error: message, ...summary }, { status: 500 });
  }
  return Response.json({ ok: true, ...summary });
}

async function pushTable(env: Env, db: D1Database, table: "touches" | "pageviews") {
  const markKey = `hwm_${table}`;
  const markRow = await db.prepare("SELECT value FROM push_state WHERE key = ?1").bind(markKey).first<{ value: string }>();
  let mark = markRow ? Number(markRow.value) : 0;
  let sent = 0;

  for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
    const rows = (
      await db
        .prepare(`SELECT * FROM ${table} WHERE id > ?1 ORDER BY id ASC LIMIT ${BATCH_SIZE}`)
        .bind(mark)
        .all<Record<string, unknown>>()
    ).results;
    if (rows.length === 0) break;

    const newMark = rows[rows.length - 1].id as number;
    const url = `${env.REACH_WEBHOOK_URL}${env.REACH_WEBHOOK_URL.includes("?") ? "&" : "?"}key=${encodeURIComponent(env.REACH_WEBHOOK_KEY)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "identity_endpoint_history",
        table,
        rows,
        high_water_mark: newMark,
        sent_at: new Date().toISOString(),
      }),
    });
    if (!res.ok) throw new Error(`Reach rejected ${table} batch: HTTP ${res.status}`);

    mark = newMark;
    sent += rows.length;
    await db
      .prepare(
        "INSERT INTO push_state (key, value, updated_at) VALUES (?1, ?2, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = datetime('now')"
      )
      .bind(markKey, String(mark))
      .run();
  }
  return { rows_sent: sent, high_water_mark: mark };
}

async function prune(db: D1Database) {
  // Roll pageviews older than the retention window into daily path counts,
  // then delete raw rows. Required, not hygiene: SQLite storage on the
  // Business plan is capped at 1 GB (0a outcome).
  await db
    .prepare(
      `INSERT INTO pageview_rollups (day, path, views, bot_views)
       SELECT date(ts), path, COUNT(*), SUM(is_bot)
         FROM pageviews
        WHERE ts < datetime('now', '-${PAGEVIEW_RETENTION_DAYS} days')
        GROUP BY date(ts), path
       ON CONFLICT(day, path) DO UPDATE SET
         views = views + excluded.views,
         bot_views = bot_views + excluded.bot_views`
    )
    .run();
  const pv = await db
    .prepare(`DELETE FROM pageviews WHERE ts < datetime('now', '-${PAGEVIEW_RETENTION_DAYS} days')`)
    .run();
  const t = await db
    .prepare(`DELETE FROM touches WHERE ts < datetime('now', '-${TOUCH_RETENTION_DAYS} days')`)
    .run();
  return { pageviews_pruned: pv.meta.changes, touches_pruned: t.meta.changes };
}
