-- Eclipse: the registry and event log for every external system (desk, Even G2, R1 ring, other wearables).

CREATE TABLE devices (
  id TEXT PRIMARY KEY,                -- short slug, e.g. 'desk', 'g2', 'r1'
  kind TEXT NOT NULL CHECK (kind IN ('desk', 'glasses', 'ring', 'watch', 'phone', 'sensor', 'other')),
  name TEXT NOT NULL,
  vendor TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  -- A device with no network of its own (the R1 ring) reports through a parent (the G2 glasses app).
  parent_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  -- JSON array of capability tags, e.g. ["hud","gesture","mic"]. Informational; rules key off kind.
  capabilities TEXT NOT NULL DEFAULT '[]',
  -- SHA-256 of the device's bearer token. NULL for devices that only report through a parent.
  token_hash TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL
);

-- Latest known state per device (charging, seated, battery, focus mode ...), merged from events.
CREATE TABLE device_state (
  device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  data TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

-- Append-only event log. Pruned to 30 days by the cron job.
CREATE TABLE device_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  ts INTEGER NOT NULL
);
CREATE INDEX idx_device_events_ts ON device_events(ts);
CREATE INDEX idx_device_events_device ON device_events(device_id, ts);

-- Commands queued for a device; the device pulls them (no inbound ports needed on the desk).
CREATE TABLE device_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  command TEXT NOT NULL,
  args TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered')),
  created_at INTEGER NOT NULL,
  delivered_at INTEGER
);
CREATE INDEX idx_device_commands_pending ON device_commands(device_id, status);

-- Messages for heads-up surfaces (G2 lenses, the desk's clear OLED).
CREATE TABLE hud_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target TEXT NOT NULL DEFAULT 'all' CHECK (target IN ('all', 'glasses', 'desk')),
  text TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 1,  -- 0 low, 1 normal, 2 urgent
  source TEXT NOT NULL DEFAULT 'owner',
  -- De-duplicates rule-generated messages (e.g. one stand-up reminder per sitting).
  dedupe_key TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  acked_at INTEGER
);
CREATE INDEX idx_hud_open ON hud_messages(acked_at, target);
