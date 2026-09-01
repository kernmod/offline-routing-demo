ALTER TABLE segments ADD COLUMN name TEXT NOT NULL DEFAULT 'Legacy segment';
ALTER TABLE segments ADD COLUMN publication_state TEXT NOT NULL DEFAULT 'published'
  CHECK (publication_state = 'published');
ALTER TABLE segments ADD COLUMN elevations_json TEXT
  CHECK (elevations_json IS NULL OR json_valid(elevations_json));
ALTER TABLE segments ADD COLUMN control_points_json TEXT;
ALTER TABLE segments ADD COLUMN elevation_gain_m INTEGER
  CHECK (elevation_gain_m IS NULL OR elevation_gain_m >= 0);
ALTER TABLE segments ADD COLUMN elevation_loss_m INTEGER
  CHECK (elevation_loss_m IS NULL OR elevation_loss_m >= 0);
ALTER TABLE segments ADD COLUMN metrics_version INTEGER NOT NULL DEFAULT 1
  CHECK (metrics_version IN (1, 2));
ALTER TABLE segments ADD COLUMN idempotency_body_hash TEXT
  CHECK (idempotency_body_hash IS NULL OR length(idempotency_body_hash) = 64);

UPDATE segments
SET name = CASE WHEN is_seed = 1 THEN 'Sydney CBD reference' ELSE 'Legacy segment' END,
    control_points_json = printf('[0,%d]', point_count - 1);

CREATE INDEX IF NOT EXISTS idx_segments_publication_expiry
  ON segments(publication_state, is_seed, expires_at);

CREATE TRIGGER IF NOT EXISTS trg_segments_v2_insert_guard
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

CREATE TRIGGER IF NOT EXISTS trg_segments_v2_update_guard
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
