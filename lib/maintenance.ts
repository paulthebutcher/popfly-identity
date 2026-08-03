const PAGEVIEW_RETENTION_DAYS = 90;
const TOUCH_RETENTION_DAYS = 400;

export async function prune(db: D1Database, touchesHwm: number, pageviewsHwm: number) {
  // D1 batch statements commit as one transaction. A failed delete therefore
  // rolls back the rollup too, preventing the next run from double-counting.
  const rollup = db.prepare(
    `INSERT INTO pageview_rollups (day, path, views, bot_views)
     SELECT date(ts), path, COUNT(*), SUM(is_bot)
       FROM pageviews
      WHERE ts < datetime('now', '-${PAGEVIEW_RETENTION_DAYS} days') AND id <= ?1
      GROUP BY date(ts), path
     ON CONFLICT(day, path) DO UPDATE SET
       views = views + excluded.views,
       bot_views = bot_views + excluded.bot_views`
  ).bind(pageviewsHwm);
  const deletePageviews = db
    .prepare(`DELETE FROM pageviews WHERE ts < datetime('now', '-${PAGEVIEW_RETENTION_DAYS} days') AND id <= ?1`)
    .bind(pageviewsHwm);
  const deleteTouches = db
    .prepare(`DELETE FROM touches WHERE ts < datetime('now', '-${TOUCH_RETENTION_DAYS} days') AND id <= ?1`)
    .bind(touchesHwm);

  const [, pv, t] = await db.batch([rollup, deletePageviews, deleteTouches]);
  return { pageviews_pruned: pv.meta.changes, touches_pruned: t.meta.changes };
}
