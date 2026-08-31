INSERT OR IGNORE INTO segments (
  id,
  encoded_geometry,
  point_count,
  distance_m,
  min_lat,
  min_lng,
  max_lat,
  max_lng,
  created_at,
  expires_at,
  idempotency_key_hash,
  is_seed
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  'vxdr_Awgal_Hfw@gw@',
  2,
  130,
  -33.8696,
  151.2091,
  -33.8687,
  151.21,
  '2026-08-31T00:00:00.000Z',
  NULL,
  NULL,
  1
);

INSERT OR IGNORE INTO segment_cells (tile_key, segment_id)
VALUES ('14/15073/9831', '00000000-0000-4000-8000-000000000001');
