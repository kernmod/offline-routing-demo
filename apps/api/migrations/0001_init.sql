CREATE TABLE IF NOT EXISTS segments (
  id TEXT PRIMARY KEY,
  encoded_geometry TEXT NOT NULL,
  point_count INTEGER NOT NULL CHECK (point_count BETWEEN 2 AND 128),
  distance_m INTEGER NOT NULL CHECK (distance_m >= 0),
  min_lat REAL NOT NULL,
  min_lng REAL NOT NULL,
  max_lat REAL NOT NULL,
  max_lng REAL NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  idempotency_key_hash TEXT UNIQUE,
  is_seed INTEGER NOT NULL DEFAULT 0 CHECK (is_seed IN (0, 1)),
  CHECK (min_lat <= max_lat),
  CHECK (min_lng <= max_lng)
);

CREATE TABLE IF NOT EXISTS segment_cells (
  tile_key TEXT NOT NULL,
  segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  PRIMARY KEY (tile_key, segment_id)
);

CREATE INDEX IF NOT EXISTS idx_segment_cells_segment_id
  ON segment_cells(segment_id);

CREATE INDEX IF NOT EXISTS idx_segments_expiry
  ON segments(is_seed, expires_at);
