-- Key/value app settings (likes playlist id, shortcut token hash, ...).
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Single owner's Google tokens, encrypted with AES-GCM.
CREATE TABLE oauth_tokens (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  email TEXT NOT NULL,
  channel_id TEXT,
  channel_title TEXT,
  scope TEXT,
  refresh_token_enc TEXT NOT NULL,
  access_token_enc TEXT,
  access_expires_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE playlists (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  item_count INTEGER,
  privacy TEXT,
  synced_at INTEGER NOT NULL
);

CREATE TABLE videos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  channel_id TEXT,
  channel_title TEXT,
  description TEXT,
  tags TEXT,
  yt_category_id TEXT,
  duration TEXT,
  published_at TEXT,
  thumbnail TEXT,
  available INTEGER NOT NULL DEFAULT 1,
  details_fetched INTEGER NOT NULL DEFAULT 0,
  embedding TEXT,
  added_at INTEGER NOT NULL,
  synced_at INTEGER NOT NULL
);

-- Where each video came from: 'liked', 'submitted', or 'playlist:<id>'.
CREATE TABLE video_sources (
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (video_id, source)
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('proposed', 'active', 'archived')),
  embedding TEXT,
  centroid TEXT,
  example_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE classifications (
  video_id TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  confidence REAL NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('auto', 'corrected', 'confirmed')),
  needs_review INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_class_category ON classifications(category_id);

CREATE TABLE corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id TEXT NOT NULL,
  from_category_id INTEGER,
  to_category_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Resumable job cursors.
CREATE TABLE sync_state (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('info', 'ok', 'warn', 'error')),
  message TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sync_log_ts ON sync_log(ts);

-- YouTube quota units spent per Pacific-time day (Google resets at midnight PT).
CREATE TABLE quota_usage (
  day TEXT PRIMARY KEY,
  units INTEGER NOT NULL
);
