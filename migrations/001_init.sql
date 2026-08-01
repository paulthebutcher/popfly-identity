-- 001_init.sql — Popfly Identity Server initial schema.
-- Spec §4 DDL plus documented additions (see docs/DECISIONS.md):
--   geo_city/geo_country on both event tables (fuzzy RB2B join, 0b outcome),
--   push_state (high-water marks for /e/push), pageview_rollups (daily path
--   counts surviving the 90-day raw prune).
-- Migrations must be additive (Webflow Cloud applies them on deploy).

CREATE TABLE touches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id TEXT NOT NULL,
  session_id TEXT,
  ts TEXT DEFAULT (datetime('now')),
  landing_page TEXT,                -- normalized path
  landing_url_raw TEXT,             -- full URL w/ query, for debugging
  referrer TEXT,
  referrer_host TEXT,               -- parsed; handles android-app://
  params TEXT,                      -- JSON of attribution params present
  channel TEXT NOT NULL,            -- derived, see lib/classify.ts
  source TEXT,
  medium TEXT,
  campaign TEXT,
  touch_index INTEGER,              -- 1 = first touch for this visitor
  rules_version INTEGER NOT NULL,   -- which classifier version wrote this row
  is_bot INTEGER DEFAULT 0,
  geo_city TEXT,                    -- coarse Cloudflare geo, never IP
  geo_country TEXT,
  rb2b_id TEXT,                     -- RB2B _reb2buid if present at touch time
  dedup_key TEXT UNIQUE             -- SHA-256(vid + params + host + 30m bucket)
);
CREATE INDEX idx_touches_visitor ON touches(visitor_id, ts);
CREATE INDEX idx_touches_channel ON touches(channel, ts);
-- retention: /e/push prunes rows > 400 days (matches cookie life)

CREATE TABLE pageviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  ts TEXT DEFAULT (datetime('now')),
  path TEXT NOT NULL,               -- normalized, no query string
  query TEXT,                       -- raw query preserved separately
  referrer TEXT,
  touch_id INTEGER,                 -- the touch written in the same request, if any
  is_bot INTEGER DEFAULT 0,
  geo_city TEXT,
  geo_country TEXT
);
CREATE INDEX idx_pv_visitor ON pageviews(visitor_id, ts);
CREATE INDEX idx_pv_session ON pageviews(session_id, ts);
-- retention: /e/push rolls up to pageview_rollups then prunes raw rows > 90 days

CREATE TABLE pageview_rollups (
  day TEXT NOT NULL,                -- YYYY-MM-DD
  path TEXT NOT NULL,
  views INTEGER NOT NULL,
  bot_views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path)
);

CREATE TABLE dead_letters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT,
  payload TEXT NOT NULL,
  error TEXT,
  attempts INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  replayed_at TEXT
);

-- Key/value state for /e/push: high-water marks per table, last run info.
CREATE TABLE push_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);
