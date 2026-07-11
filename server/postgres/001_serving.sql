CREATE TABLE IF NOT EXISTS readiness_probes (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  checked_at TIMESTAMPTZ NOT NULL
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
  source_asset_id TEXT NOT NULL,
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
  quality TEXT NOT NULL CHECK (quality IN ('provisional', 'verified', 'rejected')),
  payload_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source, source_event_id)
);

CREATE INDEX IF NOT EXISTS rain_observations_readiness
  ON rain_observations(source, quality, observed_at DESC, ((payload_json ->> 'icaoId')));

CREATE OR REPLACE FUNCTION weathercast_reject_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Weathercast serving records are immutable';
END;
$$;

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
