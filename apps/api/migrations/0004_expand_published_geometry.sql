CREATE TABLE segments_expanded (
  id TEXT PRIMARY KEY,
  encoded_geometry TEXT NOT NULL,
  point_count INTEGER NOT NULL CHECK (point_count BETWEEN 2 AND 4096),
  distance_m INTEGER NOT NULL CHECK (distance_m >= 0),
  min_lat REAL NOT NULL,
  min_lng REAL NOT NULL,
  max_lat REAL NOT NULL,
  max_lng REAL NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  idempotency_key_hash TEXT UNIQUE,
  is_seed INTEGER NOT NULL DEFAULT 0 CHECK (is_seed IN (0, 1)),
  name TEXT NOT NULL DEFAULT 'Legacy segment',
  publication_state TEXT NOT NULL DEFAULT 'published' CHECK (publication_state = 'published'),
  elevations_json TEXT CHECK (elevations_json IS NULL OR json_valid(elevations_json)),
  control_points_json TEXT,
  elevation_gain_m INTEGER CHECK (elevation_gain_m IS NULL OR elevation_gain_m >= 0),
  elevation_loss_m INTEGER CHECK (elevation_loss_m IS NULL OR elevation_loss_m >= 0),
  metrics_version INTEGER NOT NULL DEFAULT 1 CHECK (metrics_version IN (1, 2)),
  idempotency_body_hash TEXT CHECK (idempotency_body_hash IS NULL OR length(idempotency_body_hash) = 64),
  CHECK (min_lat <= max_lat),
  CHECK (min_lng <= max_lng)
);

INSERT INTO segments_expanded (
  id, encoded_geometry, point_count, distance_m, min_lat, min_lng, max_lat, max_lng,
  created_at, expires_at, idempotency_key_hash, is_seed, name, publication_state,
  elevations_json, control_points_json, elevation_gain_m, elevation_loss_m,
  metrics_version, idempotency_body_hash
)
SELECT
  id, encoded_geometry, point_count, distance_m, min_lat, min_lng, max_lat, max_lng,
  created_at, expires_at, idempotency_key_hash, is_seed, name, publication_state,
  elevations_json, control_points_json, elevation_gain_m, elevation_loss_m,
  metrics_version, idempotency_body_hash
FROM segments;

CREATE TABLE segment_cells_expanded (
  tile_key TEXT NOT NULL,
  segment_id TEXT NOT NULL REFERENCES segments_expanded(id) ON DELETE CASCADE,
  PRIMARY KEY (tile_key, segment_id)
);

INSERT INTO segment_cells_expanded (tile_key, segment_id)
SELECT tile_key, segment_id FROM segment_cells;

DROP TABLE segment_cells;
DROP TABLE segments;
ALTER TABLE segments_expanded RENAME TO segments;
ALTER TABLE segment_cells_expanded RENAME TO segment_cells;

CREATE INDEX idx_segment_cells_segment_id ON segment_cells(segment_id);
CREATE INDEX idx_segments_expiry ON segments(is_seed, expires_at);
CREATE INDEX idx_segments_publication_expiry
  ON segments(publication_state, is_seed, expires_at);

CREATE TRIGGER trg_segments_v2_insert_guard
BEFORE INSERT ON segments
WHEN NEW.metrics_version = 2 AND (
  NEW.publication_state <> 'published' OR
  length(trim(NEW.name)) < 1 OR length(NEW.name) > 80 OR
  NEW.elevations_json IS NULL OR json_valid(NEW.elevations_json) = 0 OR
  json_array_length(NEW.elevations_json) <> NEW.point_count OR
  NEW.control_points_json IS NULL OR json_valid(NEW.control_points_json) = 0 OR
  json_array_length(NEW.control_points_json) < 2 OR
  NEW.elevation_gain_m IS NULL OR NEW.elevation_loss_m IS NULL OR
  NEW.idempotency_key_hash IS NULL OR NEW.idempotency_body_hash IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'invalid v2 published segment');
END;

CREATE TRIGGER trg_segments_v2_update_guard
BEFORE UPDATE ON segments
WHEN NEW.metrics_version = 2 AND (
  NEW.publication_state <> 'published' OR
  length(trim(NEW.name)) < 1 OR length(NEW.name) > 80 OR
  NEW.elevations_json IS NULL OR json_valid(NEW.elevations_json) = 0 OR
  json_array_length(NEW.elevations_json) <> NEW.point_count OR
  NEW.control_points_json IS NULL OR json_valid(NEW.control_points_json) = 0 OR
  json_array_length(NEW.control_points_json) < 2 OR
  NEW.elevation_gain_m IS NULL OR NEW.elevation_loss_m IS NULL OR
  NEW.idempotency_key_hash IS NULL OR NEW.idempotency_body_hash IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'invalid v2 published segment');
END;
