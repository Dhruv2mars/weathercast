import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Nowcast } from '@/types/weather';
import { studyDefinitionSchema, type StudyDefinition, type StudyTarget } from './study-contract';

export type NowcastEnvelope = Nowcast & {
  schemaVersion: 1;
  forecastId: string;
  generatedAt: string;
  validUntil: string;
  timezone: string;
  sourceDataTime: string | null;
  calibrationStatus: 'uncalibrated' | 'provisional' | 'calibrated';
  coverage: {
    reason: string;
    spatialResolutionKm: number | null;
  };
};

type StoredForecast = {
  id: string;
  response_json: string;
};

type VerificationRow = {
  forecast_id: string;
  response_json: string;
  observed_at: string;
  rain_observed: number;
};

type RadarVerificationRow = {
  run_id: string;
  response_json: string;
  observed_at: string;
  rain_observed: number;
};

export type RainObservationInput = {
  source: string;
  sourceEventId: string;
  observedAt: string;
  latitude: number;
  longitude: number;
  rainObserved: boolean;
  rainRateMmHour?: number;
  accumulationMm?: number;
  quality: 'provisional' | 'verified' | 'rejected';
  truthResolutionSeconds?: number;
  onsetPublishable?: boolean;
  sourceAssetId?: string;
  payload: unknown;
};

export type SourceAssetInput = {
  provider: string;
  upstreamKey: string;
  retrievedAt: string;
  mediaType: string;
  bytes: Uint8Array;
};

export type RadarFrameInput = {
  domain: string;
  product: string;
  observedAt: string;
  retrievedAt: string;
  objectKey: string;
  sourceAssetId: string;
};

export type RadarNowcastRunInput = {
  issuedAt: string;
  sourceDataTime: string;
  latitude: number;
  longitude: number;
  domain: string;
  product: string;
  algorithmVersion: string;
  inputFrameIds: string[];
  response: unknown;
};

export type VerificationStudyRadarBatchInput = {
  studyId: string;
  scheduledAt: string;
  issuedAt: string;
  runs: Array<{
    targetId: string;
    run: Omit<RadarNowcastRunInput, 'issuedAt'>;
  }>;
};

export function locationCell(latitude: number, longitude: number) {
  return `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
}

export function createForecastId(cell: string, provider: string, issuedAt: string, response: Nowcast) {
  return createHash('sha256')
    .update(JSON.stringify({ cell, provider, issuedAt, response }))
    .digest('hex')
    .slice(0, 24);
}

export class ForecastArchive {
  private readonly database: Database;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.database = new Database(path, { create: true, strict: true });
    this.database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS source_assets (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        upstream_key TEXT NOT NULL,
        retrieved_at TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        media_type TEXT NOT NULL,
        byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
        payload BLOB NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(provider, upstream_key, sha256)
      );
      CREATE TABLE IF NOT EXISTS forecast_issues (
        id TEXT PRIMARY KEY,
        issued_at TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        valid_until TEXT NOT NULL,
        location_cell TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        provider TEXT NOT NULL,
        upstream_run_id TEXT,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS radar_frames (
        id TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        product TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        retrieved_at TEXT NOT NULL,
        object_key TEXT NOT NULL,
        source_asset_id TEXT NOT NULL REFERENCES source_assets(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(domain, product, observed_at)
      );
      CREATE INDEX IF NOT EXISTS radar_frames_product_time
        ON radar_frames(domain, product, observed_at DESC);
      CREATE TABLE IF NOT EXISTS radar_nowcast_runs (
        id TEXT PRIMARY KEY,
        issued_at TEXT NOT NULL,
        source_data_time TEXT NOT NULL,
        location_cell TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        domain TEXT NOT NULL,
        product TEXT NOT NULL,
        algorithm_version TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(algorithm_version, location_cell, source_data_time)
      );
      CREATE TABLE IF NOT EXISTS radar_nowcast_inputs (
        run_id TEXT NOT NULL REFERENCES radar_nowcast_runs(id),
        frame_id TEXT NOT NULL REFERENCES radar_frames(id),
        sequence INTEGER NOT NULL CHECK (sequence >= 0),
        PRIMARY KEY(run_id, sequence),
        UNIQUE(run_id, frame_id)
      );
      CREATE INDEX IF NOT EXISTS radar_nowcast_runs_cell_time
        ON radar_nowcast_runs(location_cell, source_data_time DESC);
      CREATE TABLE IF NOT EXISTS radar_nowcast_scores (
        run_id TEXT NOT NULL REFERENCES radar_nowcast_runs(id),
        metric TEXT NOT NULL,
        horizon_minutes INTEGER NOT NULL,
        verification_version TEXT NOT NULL,
        value REAL NOT NULL,
        observation_count INTEGER NOT NULL CHECK (observation_count > 0),
        computed_at TEXT NOT NULL,
        PRIMARY KEY(run_id, metric, horizon_minutes, verification_version)
      );
      CREATE TABLE IF NOT EXISTS verification_studies (
        id TEXT PRIMARY KEY,
        registered_at TEXT NOT NULL,
        starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL,
        algorithm_version TEXT NOT NULL,
        domain TEXT NOT NULL,
        product TEXT NOT NULL,
        primary_metric TEXT NOT NULL,
        issue_cadence_minutes INTEGER NOT NULL CHECK (issue_cadence_minutes = 15),
        minimum_observation_count_per_horizon INTEGER NOT NULL CHECK (minimum_observation_count_per_horizon >= 100),
        definition_sha256 TEXT NOT NULL,
        definition_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS verification_study_targets (
        study_id TEXT NOT NULL REFERENCES verification_studies(id),
        target_id TEXT NOT NULL,
        location_cell TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence >= 0),
        PRIMARY KEY(study_id, target_id),
        UNIQUE(study_id, location_cell),
        UNIQUE(study_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS verification_study_radar_runs (
        study_id TEXT NOT NULL REFERENCES verification_studies(id),
        target_id TEXT NOT NULL,
        scheduled_at TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        source_data_time TEXT NOT NULL,
        run_id TEXT NOT NULL REFERENCES radar_nowcast_runs(id),
        PRIMARY KEY(study_id, target_id, scheduled_at),
        UNIQUE(study_id, target_id, source_data_time),
        UNIQUE(study_id, run_id),
        FOREIGN KEY(study_id, target_id)
          REFERENCES verification_study_targets(study_id, target_id)
      );
      CREATE INDEX IF NOT EXISTS verification_study_radar_runs_schedule
        ON verification_study_radar_runs(study_id, scheduled_at, target_id);
      CREATE INDEX IF NOT EXISTS forecast_issues_cell_fresh
        ON forecast_issues(location_cell, valid_until DESC);
      CREATE TABLE IF NOT EXISTS rain_observations (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_event_id TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        location_cell TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        source_asset_id TEXT REFERENCES source_assets(id),
        rain_observed INTEGER NOT NULL CHECK (rain_observed IN (0, 1)),
        rain_rate_mm_hour REAL,
        accumulation_mm REAL,
        quality TEXT NOT NULL CHECK (quality IN ('provisional', 'verified', 'rejected')),
        truth_resolution_seconds INTEGER NOT NULL CHECK (truth_resolution_seconds > 0),
        onset_publishable INTEGER NOT NULL CHECK (onset_publishable IN (0, 1)),
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(source, source_event_id)
      );
      CREATE INDEX IF NOT EXISTS rain_observations_cell_time
        ON rain_observations(location_cell, observed_at);
      CREATE TABLE IF NOT EXISTS forecast_scores (
        forecast_id TEXT NOT NULL REFERENCES forecast_issues(id),
        metric TEXT NOT NULL,
        horizon_minutes INTEGER NOT NULL,
        verification_version TEXT NOT NULL,
        value REAL NOT NULL,
        observation_count INTEGER NOT NULL,
        computed_at TEXT NOT NULL,
        PRIMARY KEY(forecast_id, metric, horizon_minutes, verification_version)
      );
      CREATE TRIGGER IF NOT EXISTS forecast_issues_no_update
        BEFORE UPDATE ON forecast_issues BEGIN SELECT RAISE(ABORT, 'forecast issues are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS forecast_issues_no_delete
        BEFORE DELETE ON forecast_issues BEGIN SELECT RAISE(ABORT, 'forecast issues are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS rain_observations_no_update
        BEFORE UPDATE ON rain_observations BEGIN SELECT RAISE(ABORT, 'rain observations are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS rain_observations_no_delete
        BEFORE DELETE ON rain_observations BEGIN SELECT RAISE(ABORT, 'rain observations are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS forecast_scores_no_update
        BEFORE UPDATE ON forecast_scores BEGIN SELECT RAISE(ABORT, 'forecast scores are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS forecast_scores_no_delete
        BEFORE DELETE ON forecast_scores BEGIN SELECT RAISE(ABORT, 'forecast scores are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS source_assets_no_update
        BEFORE UPDATE ON source_assets BEGIN SELECT RAISE(ABORT, 'source assets are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS source_assets_no_delete
        BEFORE DELETE ON source_assets BEGIN SELECT RAISE(ABORT, 'source assets are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS radar_frames_no_update
        BEFORE UPDATE ON radar_frames BEGIN SELECT RAISE(ABORT, 'radar frames are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS radar_frames_no_delete
        BEFORE DELETE ON radar_frames BEGIN SELECT RAISE(ABORT, 'radar frames are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS radar_nowcast_runs_no_update
        BEFORE UPDATE ON radar_nowcast_runs BEGIN SELECT RAISE(ABORT, 'radar nowcast runs are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS radar_nowcast_runs_no_delete
        BEFORE DELETE ON radar_nowcast_runs BEGIN SELECT RAISE(ABORT, 'radar nowcast runs are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS radar_nowcast_inputs_no_update
        BEFORE UPDATE ON radar_nowcast_inputs BEGIN SELECT RAISE(ABORT, 'radar nowcast inputs are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS radar_nowcast_inputs_no_delete
        BEFORE DELETE ON radar_nowcast_inputs BEGIN SELECT RAISE(ABORT, 'radar nowcast inputs are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS radar_nowcast_scores_no_update
        BEFORE UPDATE ON radar_nowcast_scores BEGIN SELECT RAISE(ABORT, 'radar nowcast scores are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS radar_nowcast_scores_no_delete
        BEFORE DELETE ON radar_nowcast_scores BEGIN SELECT RAISE(ABORT, 'radar nowcast scores are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS verification_studies_no_update
        BEFORE UPDATE ON verification_studies BEGIN SELECT RAISE(ABORT, 'verification studies are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS verification_studies_no_delete
        BEFORE DELETE ON verification_studies BEGIN SELECT RAISE(ABORT, 'verification studies are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS verification_study_targets_no_update
        BEFORE UPDATE ON verification_study_targets BEGIN SELECT RAISE(ABORT, 'verification study targets are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS verification_study_targets_no_delete
        BEFORE DELETE ON verification_study_targets BEGIN SELECT RAISE(ABORT, 'verification study targets are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS verification_study_radar_runs_no_update
        BEFORE UPDATE ON verification_study_radar_runs BEGIN SELECT RAISE(ABORT, 'verification study radar run links are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS verification_study_radar_runs_no_delete
        BEFORE DELETE ON verification_study_radar_runs BEGIN SELECT RAISE(ABORT, 'verification study radar run links are immutable'); END;
    `);
    this.ensureColumn('rain_observations', 'source_asset_id', 'TEXT REFERENCES source_assets(id)');
    this.ensureColumn('rain_observations', 'truth_resolution_seconds', 'INTEGER NOT NULL DEFAULT 3600 CHECK (truth_resolution_seconds > 0)');
    this.ensureColumn('rain_observations', 'onset_publishable', 'INTEGER NOT NULL DEFAULT 0 CHECK (onset_publishable IN (0, 1))');
  }

  private ensureColumn(table: string, column: string, definition: string) {
    const columns = this.database.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
    if (!columns.some((candidate) => candidate.name === column)) {
      this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  isReady() {
    return this.database.query('SELECT 1 AS ready').get() !== null;
  }

  findFresh(cell: string, now: Date): NowcastEnvelope | null {
    const row = this.database.query<StoredForecast, [string, string]>(`
      SELECT id, response_json
      FROM forecast_issues
      WHERE location_cell = ? AND valid_until > ?
      ORDER BY generated_at DESC
      LIMIT 1
    `).get(cell, now.toISOString());
    return row ? JSON.parse(row.response_json) as NowcastEnvelope : null;
  }

  save(input: {
    envelope: NowcastEnvelope;
    cell: string;
    latitude: number;
    longitude: number;
    provider: string;
    upstreamRunId?: string;
  }) {
    this.database.query(`
      INSERT OR IGNORE INTO forecast_issues (
        id, issued_at, generated_at, valid_until, location_cell, latitude, longitude,
        provider, upstream_run_id, response_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.envelope.forecastId,
      input.envelope.issuedAt,
      input.envelope.generatedAt,
      input.envelope.validUntil,
      input.cell,
      input.latitude,
      input.longitude,
      input.provider,
      input.upstreamRunId ?? null,
      JSON.stringify(input.envelope),
    );
  }

  countForecasts() {
    const row = this.database.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM forecast_issues').get();
    return row?.count ?? 0;
  }

  saveObservation(input: RainObservationInput) {
    const cell = locationCell(input.latitude, input.longitude);
    const id = createHash('sha256')
      .update(JSON.stringify({ source: input.source, sourceEventId: input.sourceEventId }))
      .digest('hex')
      .slice(0, 24);
    this.database.query(`
      INSERT OR IGNORE INTO rain_observations (
        id, source, source_event_id, observed_at, location_cell, latitude, longitude,
        source_asset_id, rain_observed, rain_rate_mm_hour, accumulation_mm, quality,
        truth_resolution_seconds, onset_publishable, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.source,
      input.sourceEventId,
      input.observedAt,
      cell,
      Number(input.latitude.toFixed(4)),
      Number(input.longitude.toFixed(4)),
      input.sourceAssetId ?? null,
      input.rainObserved ? 1 : 0,
      input.rainRateMmHour ?? null,
      input.accumulationMm ?? null,
      input.quality,
      input.truthResolutionSeconds ?? 3_600,
      input.onsetPublishable ? 1 : 0,
      JSON.stringify(input.payload),
    );
    return id;
  }

  saveSourceAsset(input: SourceAssetInput) {
    const sha256 = createHash('sha256').update(input.bytes).digest('hex');
    const id = sha256.slice(0, 24);
    this.database.query(`
      INSERT OR IGNORE INTO source_assets (
        id, provider, upstream_key, retrieved_at, sha256, media_type, byte_length, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.provider,
      input.upstreamKey,
      input.retrievedAt,
      sha256,
      input.mediaType,
      input.bytes.byteLength,
      input.bytes,
    );
    return { id, sha256 };
  }

  countSourceAssets() {
    const row = this.database.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM source_assets').get();
    return row?.count ?? 0;
  }

  getSourceAsset(id: string) {
    return this.database.query<{
      id: string;
      sha256: string;
      media_type: string;
      payload: Uint8Array;
    }, [string]>('SELECT id, sha256, media_type, payload FROM source_assets WHERE id = ?').get(id);
  }

  listObservationPoints(limit = 50) {
    return this.database.query<{ latitude: number; longitude: number }, [number]>(`
      SELECT latitude, longitude
      FROM rain_observations
      WHERE quality != 'rejected'
      GROUP BY location_cell
      ORDER BY MAX(observed_at) DESC
      LIMIT ?
    `).all(limit);
  }

  listLatestMetarTargets(limit = 400) {
    return this.database.query<{
      id: string;
      latitude: number;
      longitude: number;
      observed_at: string;
    }, [number]>(`
      WITH ranked AS (
        SELECT json_extract(payload_json, '$.icaoId') AS id, latitude, longitude, observed_at,
          ROW_NUMBER() OVER (
            PARTITION BY json_extract(payload_json, '$.icaoId')
            ORDER BY observed_at DESC
          ) AS rank
        FROM rain_observations
        WHERE source = 'aviation-weather-metar' AND quality = 'verified'
      )
      SELECT id, latitude, longitude, observed_at
      FROM ranked
      WHERE rank = 1 AND id IS NOT NULL
      ORDER BY id
      LIMIT ?
    `).all(limit);
  }

  registerVerificationStudy(input: {
    definition: StudyDefinition;
    registeredAt: string;
    targets: StudyTarget[];
  }) {
    const definition = studyDefinitionSchema.parse(input.definition);
    const registeredTime = new Date(input.registeredAt).getTime();
    const startTime = new Date(definition.startsAt).getTime();
    if (!Number.isFinite(registeredTime) || registeredTime >= startTime) {
      throw new Error('Verification studies must be registered before they start.');
    }
    const targetById = new Map(input.targets.map((target) => [target.id, target]));
    if (
      targetById.size !== definition.stationIds.length
      || definition.stationIds.some((id) => !targetById.has(id))
    ) throw new Error('Verification study targets must exactly match the registered station cohort.');
    const targets = definition.stationIds.map((id) => targetById.get(id)!);
    if (targets.some((target) => (
      !Number.isFinite(target.latitude)
      || !Number.isFinite(target.longitude)
      || target.latitude < -90
      || target.latitude > 90
      || target.longitude < -180
      || target.longitude > 180
    ))) throw new Error('Verification study target coordinates are invalid.');
    const definitionJson = JSON.stringify({ schemaVersion: 1, ...definition, targets });
    const definitionSha256 = createHash('sha256').update(definitionJson).digest('hex');
    const register = this.database.transaction(() => {
      const result = this.database.query(`
        INSERT OR IGNORE INTO verification_studies (
          id, registered_at, starts_at, ends_at, algorithm_version, domain, product,
          primary_metric, issue_cadence_minutes, minimum_observation_count_per_horizon,
          definition_sha256, definition_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        definition.id,
        input.registeredAt,
        definition.startsAt,
        definition.endsAt,
        definition.algorithmVersion,
        definition.domain,
        definition.product,
        definition.primaryMetric,
        definition.issueCadenceMinutes,
        definition.minimumObservationCountPerHorizon,
        definitionSha256,
        definitionJson,
      );
      if (result.changes === 1) {
        const statement = this.database.query(`
          INSERT INTO verification_study_targets (
            study_id, target_id, location_cell, latitude, longitude, sequence
          ) VALUES (?, ?, ?, ?, ?, ?)
        `);
        targets.forEach((target, sequence) => statement.run(
          definition.id,
          target.id,
          locationCell(target.latitude, target.longitude),
          Number(target.latitude.toFixed(4)),
          Number(target.longitude.toFixed(4)),
          sequence,
        ));
        return { id: definition.id, definitionSha256, inserted: true, registeredAt: input.registeredAt };
      }
      const existing = this.database.query<{
        registered_at: string;
        definition_sha256: string;
      }, [string]>('SELECT registered_at, definition_sha256 FROM verification_studies WHERE id = ?')
        .get(definition.id);
      if (!existing || existing.definition_sha256 !== definitionSha256) {
        throw new Error('Verification study ID is already registered with a different definition.');
      }
      return {
        id: definition.id,
        definitionSha256,
        inserted: false,
        registeredAt: existing.registered_at,
      };
    });
    return register();
  }

  getVerificationStudy(id: string) {
    const study = this.database.query<{
      id: string;
      registered_at: string;
      starts_at: string;
      ends_at: string;
      algorithm_version: string;
      domain: string;
      product: string;
      definition_sha256: string;
      definition_json: string;
      issue_cadence_minutes: number;
      minimum_observation_count_per_horizon: number;
    }, [string]>(`
      SELECT id, registered_at, starts_at, ends_at, algorithm_version, domain, product,
        definition_sha256, definition_json, issue_cadence_minutes,
        minimum_observation_count_per_horizon
      FROM verification_studies WHERE id = ?
    `).get(id);
    if (!study) return null;
    const targets = this.database.query<{
      id: string;
      latitude: number;
      longitude: number;
    }, [string]>(`
      SELECT target_id AS id, latitude, longitude
      FROM verification_study_targets
      WHERE study_id = ?
      ORDER BY sequence
    `).all(id);
    return { ...study, targets };
  }

  saveRadarFrame(input: RadarFrameInput) {
    const id = createHash('sha256')
      .update(JSON.stringify({ domain: input.domain, product: input.product, observedAt: input.observedAt }))
      .digest('hex')
      .slice(0, 24);
    this.database.query(`
      INSERT OR IGNORE INTO radar_frames (
        id, domain, product, observed_at, retrieved_at, object_key, source_asset_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.domain,
      input.product,
      input.observedAt,
      input.retrievedAt,
      input.objectKey,
      input.sourceAssetId,
    );
    return id;
  }

  listRadarFrames(domain: string, product: string, limit = 30) {
    return this.database.query<{
      id: string;
      observed_at: string;
      retrieved_at: string;
      object_key: string;
      source_asset_id: string;
    }, [string, string, number]>(`
      SELECT id, observed_at, retrieved_at, object_key, source_asset_id
      FROM radar_frames
      WHERE domain = ? AND product = ?
      ORDER BY observed_at DESC
      LIMIT ?
    `).all(domain, product, limit);
  }

  private saveRadarNowcastRunInternal(input: RadarNowcastRunInput) {
    if (input.inputFrameIds.length < 3) throw new Error('Radar nowcast runs require at least three input frames.');
    const cell = locationCell(input.latitude, input.longitude);
    const id = createHash('sha256')
      .update(JSON.stringify({
        algorithmVersion: input.algorithmVersion,
        cell,
        sourceDataTime: input.sourceDataTime,
      }))
      .digest('hex')
      .slice(0, 24);
    const responseJson = JSON.stringify(input.response);
    const result = this.database.query(`
        INSERT OR IGNORE INTO radar_nowcast_runs (
          id, issued_at, source_data_time, location_cell, latitude, longitude,
          domain, product, algorithm_version, response_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        id,
        input.issuedAt,
        input.sourceDataTime,
        cell,
        Number(input.latitude.toFixed(4)),
        Number(input.longitude.toFixed(4)),
        input.domain,
        input.product,
        input.algorithmVersion,
        responseJson,
      );
    const statement = this.database.query(`
        INSERT OR IGNORE INTO radar_nowcast_inputs (run_id, frame_id, sequence)
        VALUES (?, ?, ?)
    `);
    if (result.changes === 1) {
      input.inputFrameIds.forEach((frameId, sequence) => statement.run(id, frameId, sequence));
      return { id, inserted: true, issuedAt: input.issuedAt };
    }
    const existing = this.database.query<{
      issued_at: string;
      response_json: string;
    }, [string]>('SELECT issued_at, response_json FROM radar_nowcast_runs WHERE id = ?').get(id);
    const existingFrames = this.database.query<{ frame_id: string }, [string]>(`
        SELECT frame_id FROM radar_nowcast_inputs WHERE run_id = ? ORDER BY sequence
    `).all(id).map((row) => row.frame_id);
    if (
      !existing
      || existing.response_json !== responseJson
      || existingFrames.length !== input.inputFrameIds.length
      || existingFrames.some((frameId, index) => frameId !== input.inputFrameIds[index])
    ) throw new Error('Radar nowcast rerun is not reproducible.');
    return { id, inserted: false, issuedAt: existing.issued_at };
  }

  saveRadarNowcastRun(input: RadarNowcastRunInput) {
    return this.database.transaction(() => this.saveRadarNowcastRunInternal(input))();
  }

  saveVerificationStudyRadarBatch(input: VerificationStudyRadarBatchInput) {
    const study = this.database.query<{
      starts_at: string;
      ends_at: string;
      algorithm_version: string;
      domain: string;
      product: string;
      issue_cadence_minutes: number;
    }, [string]>(`
      SELECT starts_at, ends_at, algorithm_version, domain, product, issue_cadence_minutes
      FROM verification_studies WHERE id = ?
    `).get(input.studyId);
    if (!study) throw new Error('Verification study is not registered.');
    const scheduledTime = new Date(input.scheduledAt).getTime();
    const issuedTime = new Date(input.issuedAt).getTime();
    const startTime = new Date(study.starts_at).getTime();
    const endTime = new Date(study.ends_at).getTime();
    const cadenceMs = study.issue_cadence_minutes * 60_000;
    if (
      !Number.isFinite(scheduledTime)
      || scheduledTime < startTime
      || scheduledTime >= endTime
      || scheduledTime % cadenceMs !== 0
    ) throw new Error('Study issue is outside its pre-registered schedule.');
    if (!Number.isFinite(issuedTime) || issuedTime < scheduledTime || issuedTime >= scheduledTime + cadenceMs) {
      throw new Error('Study issue must be completed within its scheduled cadence window.');
    }
    const targets = this.database.query<{
      target_id: string;
      location_cell: string;
    }, [string]>(`
      SELECT target_id, location_cell
      FROM verification_study_targets
      WHERE study_id = ?
      ORDER BY sequence
    `).all(input.studyId);
    if (
      input.runs.length !== targets.length
      || input.runs.some((candidate, index) => candidate.targetId !== targets[index]?.target_id)
    ) throw new Error('Study issue must contain the complete target cohort in registered order.');
    const sourceDataTimes = new Set(input.runs.map(({ run }) => run.sourceDataTime));
    if (sourceDataTimes.size !== 1) throw new Error('Study batch runs must use one common radar source time.');
    input.runs.forEach(({ run }, index) => {
      if (
        run.algorithmVersion !== study.algorithm_version
        || run.domain !== study.domain
        || run.product !== study.product
      ) throw new Error('Study run provenance does not match the registered algorithm and source.');
      if (locationCell(run.latitude, run.longitude) !== targets[index]?.location_cell) {
        throw new Error('Study run location does not match its frozen target.');
      }
      const sourceTime = new Date(run.sourceDataTime).getTime();
      if (!Number.isFinite(sourceTime) || sourceTime > issuedTime) {
        throw new Error('Study run source time must not be later than issuance.');
      }
    });

    return this.database.transaction(() => {
      const statement = this.database.query(`
        INSERT OR IGNORE INTO verification_study_radar_runs (
          study_id, target_id, scheduled_at, issued_at, source_data_time, run_id
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      const saved = input.runs.map(({ targetId, run }) => {
        const result = this.saveRadarNowcastRunInternal({ ...run, issuedAt: input.issuedAt });
        const link = statement.run(
          input.studyId,
          targetId,
          input.scheduledAt,
          result.issuedAt,
          run.sourceDataTime,
          result.id,
        );
        if (link.changes === 0) {
          const existing = this.database.query<{
            run_id: string;
            issued_at: string;
            source_data_time: string;
          }, [string, string, string]>(`
            SELECT run_id, issued_at, source_data_time
            FROM verification_study_radar_runs
            WHERE study_id = ? AND target_id = ? AND scheduled_at = ?
          `).get(input.studyId, targetId, input.scheduledAt);
          if (
            !existing
            || existing.run_id !== result.id
            || existing.issued_at !== result.issuedAt
            || existing.source_data_time !== run.sourceDataTime
          ) throw new Error('Study issue rerun is not reproducible.');
        }
        return { targetId, ...result, linked: link.changes === 1 };
      });
      return { studyId: input.studyId, scheduledAt: input.scheduledAt, runs: saved };
    })();
  }

  listVerificationStudyRadarRuns(studyId: string) {
    return this.database.query<{
      target_id: string;
      scheduled_at: string;
      issued_at: string;
      source_data_time: string;
      run_id: string;
    }, [string]>(`
      SELECT target_id, scheduled_at, issued_at, source_data_time, run_id
      FROM verification_study_radar_runs
      WHERE study_id = ?
      ORDER BY scheduled_at, target_id
    `).all(studyId);
  }

  getVerificationStudyRadarIssue(studyId: string, scheduledAt: string) {
    return this.database.query<{
      target_id: string;
      scheduled_at: string;
      issued_at: string;
      source_data_time: string;
      run_id: string;
    }, [string, string]>(`
      SELECT target_id, scheduled_at, issued_at, source_data_time, run_id
      FROM verification_study_radar_runs
      WHERE study_id = ? AND scheduled_at = ?
      ORDER BY target_id
    `).all(studyId, scheduledAt);
  }

  listRadarNowcastRuns(limit = 20) {
    return this.database.query<{
      id: string;
      issued_at: string;
      source_data_time: string;
      location_cell: string;
      algorithm_version: string;
      response_json: string;
      input_count: number;
    }, [number]>(`
      SELECT r.id, r.issued_at, r.source_data_time, r.location_cell,
        r.algorithm_version, r.response_json, COUNT(i.frame_id) AS input_count
      FROM radar_nowcast_runs r
      JOIN radar_nowcast_inputs i ON i.run_id = r.id
      GROUP BY r.id
      ORDER BY r.source_data_time DESC
      LIMIT ?
    `).all(limit);
  }

  verifyRadarBrier(verificationVersion: string, through: Date) {
    const rows = this.database.query<RadarVerificationRow, [string]>(`
      SELECT r.id AS run_id, r.response_json, o.observed_at, o.rain_observed
      FROM radar_nowcast_runs r
      JOIN rain_observations o ON o.location_cell = r.location_cell
      WHERE o.quality = 'verified'
        AND o.observed_at <= ?
        AND unixepoch(o.observed_at) >= unixepoch(r.issued_at)
        AND unixepoch(o.observed_at) >= unixepoch(r.source_data_time)
        AND unixepoch(o.observed_at) < unixepoch(r.source_data_time) + 7200
      ORDER BY r.id, o.observed_at
    `).all(through.toISOString());
    const aggregates = new Map<string, {
      runId: string;
      horizonMinutes: number;
      sum: number;
      count: number;
    }>();
    let observationsMatched = 0;
    for (const row of rows) {
      const nowcast = JSON.parse(row.response_json) as {
        sourceDataTime: string;
        intervals: Array<{
          leadStartMinutes: number;
          leadEndMinutes: number;
          status: string;
          probability: number | null;
        }>;
      };
      const leadMinutes = (new Date(row.observed_at).getTime() - new Date(nowcast.sourceDataTime).getTime()) / 60_000;
      const interval = nowcast.intervals.find((candidate) => (
        leadMinutes >= candidate.leadStartMinutes && leadMinutes < candidate.leadEndMinutes
      ));
      if (!interval || interval.status !== 'valid' || interval.probability === null) continue;
      const observed = row.rain_observed === 1 ? 1 : 0;
      const brier = (interval.probability / 100 - observed) ** 2;
      const key = `${row.run_id}:${interval.leadStartMinutes}`;
      const aggregate = aggregates.get(key) ?? {
        runId: row.run_id,
        horizonMinutes: interval.leadStartMinutes,
        sum: 0,
        count: 0,
      };
      aggregate.sum += brier;
      aggregate.count += 1;
      aggregates.set(key, aggregate);
      observationsMatched += 1;
    }
    let scoresWritten = 0;
    const statement = this.database.query(`
      INSERT OR IGNORE INTO radar_nowcast_scores (
        run_id, metric, horizon_minutes, verification_version,
        value, observation_count, computed_at
      ) VALUES (?, 'brier_rain_occurrence_point', ?, ?, ?, ?, ?)
    `);
    for (const aggregate of aggregates.values()) {
      const result = statement.run(
        aggregate.runId,
        aggregate.horizonMinutes,
        verificationVersion,
        aggregate.sum / aggregate.count,
        aggregate.count,
        through.toISOString(),
      );
      scoresWritten += result.changes;
    }
    return { observationsMatched, scoresWritten };
  }

  listRadarScores() {
    return this.database.query<{
      run_id: string;
      metric: string;
      horizon_minutes: number;
      verification_version: string;
      value: number;
      observation_count: number;
    }, []>(`
      SELECT run_id, metric, horizon_minutes, verification_version, value, observation_count
      FROM radar_nowcast_scores
      ORDER BY run_id, horizon_minutes
    `).all();
  }

  verifyBrier(verificationVersion: string, through: Date) {
    const rows = this.database.query<VerificationRow, [string]>(`
      SELECT f.id AS forecast_id, f.response_json, o.observed_at, o.rain_observed
      FROM forecast_issues f
      JOIN rain_observations o ON o.location_cell = f.location_cell
      WHERE o.quality = 'verified' AND o.observed_at <= ?
    `).all(through.toISOString());
    let scoresWritten = 0;
    let observationsMatched = 0;

    for (const row of rows) {
      const forecast = JSON.parse(row.response_json) as NowcastEnvelope;
      const observedAt = new Date(row.observed_at).getTime();
      const intervalIndex = forecast.intervals.findIndex((interval) => {
        const start = new Date(interval.time).getTime();
        return observedAt >= start && observedAt < start + 15 * 60_000;
      });
      if (intervalIndex < 0) continue;
      observationsMatched += 1;
      const probability = forecast.intervals[intervalIndex].probability / 100;
      const observed = row.rain_observed === 1 ? 1 : 0;
      const brier = (probability - observed) ** 2;
      const result = this.database.query(`
        INSERT OR IGNORE INTO forecast_scores (
          forecast_id, metric, horizon_minutes, verification_version,
          value, observation_count, computed_at
        ) VALUES (?, 'brier_rain_occurrence_point', ?, ?, ?, 1, ?)
      `).run(
        row.forecast_id,
        intervalIndex * 15,
        verificationVersion,
        brier,
        through.toISOString(),
      );
      scoresWritten += result.changes;
    }
    return { observationsMatched, scoresWritten };
  }

  listScores() {
    return this.database.query<{
      forecast_id: string;
      metric: string;
      horizon_minutes: number;
      verification_version: string;
      value: number;
      observation_count: number;
    }, []>('SELECT forecast_id, metric, horizon_minutes, verification_version, value, observation_count FROM forecast_scores ORDER BY forecast_id, horizon_minutes').all();
  }

  close() {
    this.database.close();
  }
}
