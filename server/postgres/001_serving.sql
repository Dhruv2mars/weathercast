CREATE TABLE IF NOT EXISTS readiness_probes (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  checked_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS source_assets (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  upstream_key TEXT NOT NULL,
  retrieved_at TIMESTAMPTZ NOT NULL,
  sha256 TEXT NOT NULL,
  media_type TEXT NOT NULL,
  byte_length BIGINT NOT NULL CHECK (byte_length >= 0),
  payload BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider, upstream_key, sha256)
);

CREATE TABLE IF NOT EXISTS forecast_issues (
  id TEXT PRIMARY KEY,
  issued_at TIMESTAMPTZ NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  location_cell TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  provider TEXT NOT NULL,
  upstream_run_id TEXT,
  response_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS forecast_issues_cell_validity
  ON forecast_issues(location_cell, valid_until, generated_at DESC);

CREATE TABLE IF NOT EXISTS radar_frames (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  product TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  retrieved_at TIMESTAMPTZ NOT NULL,
  object_key TEXT NOT NULL,
  source_asset_id TEXT NOT NULL REFERENCES source_assets(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(domain, product, observed_at)
);

CREATE INDEX IF NOT EXISTS radar_frames_domain_product_observed
  ON radar_frames(domain, product, observed_at DESC);

CREATE TABLE IF NOT EXISTS rain_observations (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  location_cell TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  source_asset_id TEXT REFERENCES source_assets(id),
  rain_observed BOOLEAN NOT NULL,
  rain_rate_mm_hour DOUBLE PRECISION,
  accumulation_mm DOUBLE PRECISION,
  quality TEXT NOT NULL CHECK (quality IN ('provisional', 'verified', 'rejected')),
  truth_resolution_seconds INTEGER NOT NULL CHECK (truth_resolution_seconds > 0),
  onset_publishable BOOLEAN NOT NULL,
  payload_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source, source_event_id)
);

ALTER TABLE rain_observations ADD COLUMN IF NOT EXISTS location_cell TEXT;
ALTER TABLE rain_observations ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE rain_observations ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE rain_observations ADD COLUMN IF NOT EXISTS source_asset_id TEXT;
ALTER TABLE rain_observations ADD COLUMN IF NOT EXISTS rain_observed BOOLEAN;
ALTER TABLE rain_observations ADD COLUMN IF NOT EXISTS rain_rate_mm_hour DOUBLE PRECISION;
ALTER TABLE rain_observations ADD COLUMN IF NOT EXISTS accumulation_mm DOUBLE PRECISION;
ALTER TABLE rain_observations ADD COLUMN IF NOT EXISTS truth_resolution_seconds INTEGER;
ALTER TABLE rain_observations ADD COLUMN IF NOT EXISTS onset_publishable BOOLEAN;

CREATE INDEX IF NOT EXISTS rain_observations_readiness
  ON rain_observations(source, quality, observed_at DESC, ((payload_json ->> 'icaoId')));

CREATE OR REPLACE FUNCTION weathercast_reject_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Weathercast serving records are immutable';
END;
$$;

DROP TRIGGER IF EXISTS source_assets_reject_update ON source_assets;
CREATE TRIGGER source_assets_reject_update
  BEFORE UPDATE ON source_assets FOR EACH ROW EXECUTE FUNCTION weathercast_reject_mutation();
DROP TRIGGER IF EXISTS source_assets_reject_delete ON source_assets;
CREATE TRIGGER source_assets_reject_delete
  BEFORE DELETE ON source_assets FOR EACH ROW EXECUTE FUNCTION weathercast_reject_mutation();

DROP TRIGGER IF EXISTS forecast_issues_reject_update ON forecast_issues;
CREATE TRIGGER forecast_issues_reject_update
  BEFORE UPDATE ON forecast_issues FOR EACH ROW EXECUTE FUNCTION weathercast_reject_mutation();
DROP TRIGGER IF EXISTS forecast_issues_reject_delete ON forecast_issues;
CREATE TRIGGER forecast_issues_reject_delete
  BEFORE DELETE ON forecast_issues FOR EACH ROW EXECUTE FUNCTION weathercast_reject_mutation();

DROP TRIGGER IF EXISTS radar_frames_reject_update ON radar_frames;
CREATE TRIGGER radar_frames_reject_update
  BEFORE UPDATE ON radar_frames FOR EACH ROW EXECUTE FUNCTION weathercast_reject_mutation();
DROP TRIGGER IF EXISTS radar_frames_reject_delete ON radar_frames;
CREATE TRIGGER radar_frames_reject_delete
  BEFORE DELETE ON radar_frames FOR EACH ROW EXECUTE FUNCTION weathercast_reject_mutation();

DROP TRIGGER IF EXISTS rain_observations_reject_update ON rain_observations;
CREATE TRIGGER rain_observations_reject_update
  BEFORE UPDATE ON rain_observations FOR EACH ROW EXECUTE FUNCTION weathercast_reject_mutation();
DROP TRIGGER IF EXISTS rain_observations_reject_delete ON rain_observations;
CREATE TRIGGER rain_observations_reject_delete
  BEFORE DELETE ON rain_observations FOR EACH ROW EXECUTE FUNCTION weathercast_reject_mutation();
