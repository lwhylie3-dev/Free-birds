-- Phase 2: organize videos into YouTube playlists through approved plans.

-- Playlist a category's videos are added to (created on approval if NULL).
ALTER TABLE categories ADD COLUMN playlist_id TEXT;
-- Playlist the category was learned from, if it was seeded from one of the owner's playlists.
ALTER TABLE categories ADD COLUMN seed_playlist_id TEXT;
-- Set when seed memberships or examples change; the worker recomputes the centroid.
ALTER TABLE categories ADD COLUMN centroid_stale INTEGER NOT NULL DEFAULT 0;

CREATE TABLE plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'applying', 'done', 'cancelled')),
  created_at INTEGER NOT NULL,
  approved_at INTEGER,
  finished_at INTEGER
);

CREATE TABLE plan_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('create_playlist', 'add_video')),
  category_id INTEGER NOT NULL,
  video_id TEXT,
  include INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'skipped', 'failed')),
  error TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_plan_items_plan ON plan_items(plan_id, status);
CREATE INDEX idx_plan_items_video ON plan_items(video_id, category_id);
CREATE INDEX idx_video_sources_source ON video_sources(source);
