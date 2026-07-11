import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Nowcast } from '@/types/weather';
import {
  fitIsotonicCalibrationArtifact,
  verifyAppliedCalibration,
  verifyCalibrationArtifact,
  type CalibrationArtifact,
  type CalibrationSample,
} from './calibration';
import { calibrationPlanSchema, type CalibrationPlan } from './calibration-contract';
import { radarNowcastSchema } from './radar-nowcast-contract';
import { validateRadarNowcastProvenance } from './radar-nowcast-runner';
import { parseStoredStudyDefinition, studyDefinitionSchema, type StudyDefinition, type StudyTarget } from './study-contract';
import {
  computeVerificationStudyEvidence,
  type StudyVerificationObservation,
  type StudyVerificationRun,
} from './study-verification';

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

function isCanonicalIsoTimestamp(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
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
      CREATE TABLE IF NOT EXISTS verification_study_reports (
        study_id TEXT NOT NULL REFERENCES verification_studies(id),
        report_version TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        eligible_for_publication INTEGER NOT NULL CHECK (eligible_for_publication IN (0, 1)),
        report_sha256 TEXT NOT NULL,
        report_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(study_id, report_version)
      );
      CREATE TABLE IF NOT EXISTS calibration_plans (
        id TEXT PRIMARY KEY,
        registered_at TEXT NOT NULL,
        algorithm_version TEXT NOT NULL,
        domain TEXT NOT NULL,
        product TEXT NOT NULL,
        method TEXT NOT NULL,
        evaluation_study_id TEXT NOT NULL REFERENCES verification_studies(id),
        definition_sha256 TEXT NOT NULL,
        definition_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS calibration_artifacts (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES calibration_plans(id),
        artifact_version TEXT NOT NULL,
        fitted_at TEXT NOT NULL,
        eligible_for_shadow_application INTEGER NOT NULL CHECK (eligible_for_shadow_application IN (0, 1)),
        artifact_sha256 TEXT NOT NULL,
        artifact_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(plan_id, artifact_version)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS calibration_plans_evaluation_study
        ON calibration_plans(evaluation_study_id);
      CREATE TABLE IF NOT EXISTS calibration_evaluation_bindings (
        evaluation_study_id TEXT PRIMARY KEY REFERENCES verification_studies(id),
        plan_id TEXT NOT NULL UNIQUE REFERENCES calibration_plans(id),
        artifact_id TEXT NOT NULL UNIQUE REFERENCES calibration_artifacts(id),
        activated_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
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
      CREATE TRIGGER IF NOT EXISTS verification_study_reports_no_update
        BEFORE UPDATE ON verification_study_reports BEGIN SELECT RAISE(ABORT, 'verification study reports are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS verification_study_reports_no_delete
        BEFORE DELETE ON verification_study_reports BEGIN SELECT RAISE(ABORT, 'verification study reports are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS calibration_plans_no_update
        BEFORE UPDATE ON calibration_plans BEGIN SELECT RAISE(ABORT, 'calibration plans are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS calibration_plans_no_delete
        BEFORE DELETE ON calibration_plans BEGIN SELECT RAISE(ABORT, 'calibration plans are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS calibration_artifacts_no_update
        BEFORE UPDATE ON calibration_artifacts BEGIN SELECT RAISE(ABORT, 'calibration artifacts are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS calibration_artifacts_no_delete
        BEFORE DELETE ON calibration_artifacts BEGIN SELECT RAISE(ABORT, 'calibration artifacts are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS calibration_evaluation_bindings_no_update
        BEFORE UPDATE ON calibration_evaluation_bindings BEGIN SELECT RAISE(ABORT, 'calibration evaluation bindings are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS calibration_evaluation_bindings_no_delete
        BEFORE DELETE ON calibration_evaluation_bindings BEGIN SELECT RAISE(ABORT, 'calibration evaluation bindings are immutable'); END;
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
    if (!isCanonicalIsoTimestamp(input.registeredAt) || registeredTime >= startTime) {
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
    const definitionJson = JSON.stringify({ schemaVersion: 3, ...definition, targets });
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
    const definitionSha256 = createHash('sha256').update(study.definition_json).digest('hex');
    if (definitionSha256 !== study.definition_sha256) {
      throw new Error('Verification study definition checksum is invalid.');
    }
    const parsed = parseStoredStudyDefinition(JSON.parse(study.definition_json));
    return {
      ...study,
      input_frame_count: parsed.definition.inputFrameCount,
      ensemble_members: parsed.definition.ensembleMembers,
      runtime_parameters_preregistered: parsed.runtimeParametersPreregistered,
      targets,
    };
  }

  registerCalibrationPlan(input: { definition: CalibrationPlan; registeredAt: string }) {
    const definition = calibrationPlanSchema.parse(input.definition);
    if (!isCanonicalIsoTimestamp(input.registeredAt)) {
      throw new Error('Calibration plan registration time must use canonical UTC ISO format.');
    }
    const studyIds = [
      ...definition.trainingStudyIds,
      ...definition.validationStudyIds,
      definition.evaluationStudyId,
    ];
    const rows = studyIds.map((id) => this.database.query<{
      id: string;
      starts_at: string;
      ends_at: string;
      algorithm_version: string;
      domain: string;
      product: string;
      definition_json: string;
      definition_sha256: string;
    }, [string]>(`
      SELECT id, starts_at, ends_at, algorithm_version, domain, product,
        definition_json, definition_sha256
      FROM verification_studies
      WHERE id = ?
    `).get(id));
    if (rows.some((row) => !row)) throw new Error('Every calibration partition study must be registered first.');
    const studies = rows.map((row) => {
      const definitionSha256 = createHash('sha256').update(row!.definition_json).digest('hex');
      if (definitionSha256 !== row!.definition_sha256) {
        throw new Error(`Calibration partition study ${row!.id} has an invalid definition checksum.`);
      }
      const parsed = parseStoredStudyDefinition(JSON.parse(row!.definition_json));
      if (!parsed.reportPolicyPreregistered || !parsed.runtimeParametersPreregistered) {
        throw new Error(`Calibration partition study ${row!.id} did not preregister its evidence and runtime policy.`);
      }
      if (
        row!.algorithm_version !== definition.algorithmVersion
        || row!.domain !== definition.domain
        || row!.product !== definition.product
        || parsed.definition.horizonsMinutes.length !== definition.horizonsMinutes.length
        || parsed.definition.horizonsMinutes.some(
          (horizon, index) => horizon !== definition.horizonsMinutes[index],
        )
      ) throw new Error(`Calibration partition study ${row!.id} does not match the plan provenance.`);
      return { ...row!, definition: parsed.definition };
    });
    const byId = new Map(studies.map((study) => [study.id, study]));
    const training = definition.trainingStudyIds.map((id) => byId.get(id)!);
    const validation = definition.validationStudyIds.map((id) => byId.get(id)!);
    const evaluation = byId.get(definition.evaluationStudyId)!;
    if (studies.some((study) => (
      study.definition.inputFrameCount !== evaluation.definition.inputFrameCount
      || study.definition.ensembleMembers !== evaluation.definition.ensembleMembers
    ))) throw new Error('Calibration study runtime parameters differ across partitions.');
    const trainingStartsAt = Math.min(...training.map((study) => new Date(study.starts_at).getTime()));
    const trainingEndsAt = Math.max(...training.map((study) => new Date(study.ends_at).getTime()));
    const validationStartsAt = Math.min(...validation.map((study) => new Date(study.starts_at).getTime()));
    const validationEndsAt = Math.max(...validation.map((study) => new Date(study.ends_at).getTime()));
    const evaluationStartsAt = new Date(evaluation.starts_at).getTime();
    if (new Date(input.registeredAt).getTime() >= trainingStartsAt) {
      throw new Error('Calibration plans must be registered before the training partition starts.');
    }
    if (trainingEndsAt > validationStartsAt || validationEndsAt > evaluationStartsAt) {
      throw new Error('Calibration partitions must occur in training, validation, then evaluation order.');
    }
    const definitionJson = JSON.stringify({ schemaVersion: 1, ...definition });
    const definitionSha256 = createHash('sha256').update(definitionJson).digest('hex');
    const result = this.database.query(`
      INSERT OR IGNORE INTO calibration_plans (
        id, registered_at, algorithm_version, domain, product, method,
        evaluation_study_id, definition_sha256, definition_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      definition.id,
      input.registeredAt,
      definition.algorithmVersion,
      definition.domain,
      definition.product,
      definition.method,
      definition.evaluationStudyId,
      definitionSha256,
      definitionJson,
    );
    if (result.changes === 1) {
      return { id: definition.id, definitionSha256, inserted: true, registeredAt: input.registeredAt };
    }
    const existing = this.database.query<{
      registered_at: string;
      definition_sha256: string;
    }, [string]>('SELECT registered_at, definition_sha256 FROM calibration_plans WHERE id = ?')
      .get(definition.id);
    if (!existing || existing.definition_sha256 !== definitionSha256) {
      const evaluationConflict = this.database.query<{ id: string }, [string]>(
        'SELECT id FROM calibration_plans WHERE evaluation_study_id = ?',
      ).get(definition.evaluationStudyId);
      if (evaluationConflict && evaluationConflict.id !== definition.id) {
        throw new Error(
          `Evaluation study ${definition.evaluationStudyId} is already claimed by calibration plan ${evaluationConflict.id}.`,
        );
      }
      throw new Error('Calibration plan ID is already registered with a different definition.');
    }
    return {
      id: definition.id,
      definitionSha256,
      inserted: false,
      registeredAt: existing.registered_at,
    };
  }

  getCalibrationPlan(id: string) {
    const row = this.database.query<{
      id: string;
      registered_at: string;
      definition_sha256: string;
      definition_json: string;
    }, [string]>(`
      SELECT id, registered_at, definition_sha256, definition_json
      FROM calibration_plans
      WHERE id = ?
    `).get(id);
    if (!row) return null;
    const definitionSha256 = createHash('sha256').update(row.definition_json).digest('hex');
    if (definitionSha256 !== row.definition_sha256) {
      throw new Error('Calibration plan definition checksum is invalid.');
    }
    const stored = JSON.parse(row.definition_json) as { schemaVersion?: unknown };
    if (stored.schemaVersion !== 1) throw new Error('Calibration plan schema version is unsupported.');
    const definition = calibrationPlanSchema.parse(stored);
    return { ...row, definition };
  }

  getCalibrationArtifact(id: string) {
    const row = this.database.query<{
      artifact_sha256: string;
      artifact_json: string;
    }, [string]>(`
      SELECT artifact_sha256, artifact_json
      FROM calibration_artifacts
      WHERE id = ?
    `).get(id);
    if (!row) return null;
    const artifact = JSON.parse(row.artifact_json) as CalibrationArtifact;
    if (artifact.sha256 !== row.artifact_sha256) {
      throw new Error('Archived calibration artifact checksum does not match its index.');
    }
    return verifyCalibrationArtifact(artifact);
  }

  fitCalibrationPlan(input: { planId: string; artifactVersion: string; fittedAt: string }) {
    if (!isCanonicalIsoTimestamp(input.fittedAt)) {
      throw new Error('Calibration fit time must use canonical UTC ISO format.');
    }
    return this.database.transaction(() => {
      const plan = this.getCalibrationPlan(input.planId);
      if (!plan) throw new Error('Calibration plan is not registered.');
      const sourceStudyIds = [
        ...plan.definition.trainingStudyIds,
        ...plan.definition.validationStudyIds,
      ];
      const studies = sourceStudyIds.map((id) => this.database.query<{
        id: string;
        ends_at: string;
      }, [string]>('SELECT id, ends_at FROM verification_studies WHERE id = ?').get(id));
      const evaluation = this.database.query<{
        starts_at: string;
        definition_sha256: string;
      }, [string]>(`
        SELECT starts_at, definition_sha256
        FROM verification_studies
        WHERE id = ?
      `).get(plan.definition.evaluationStudyId);
      if (studies.some((study) => !study) || !evaluation) {
        throw new Error('Calibration plan references an unavailable study.');
      }
      const fittedTime = new Date(input.fittedAt).getTime();
      const latestSourceEnd = Math.max(...studies.map((study) => new Date(study!.ends_at).getTime()));
      if (fittedTime < latestSourceEnd) {
        throw new Error('Calibration fitting requires completed training and validation partitions.');
      }
      if (fittedTime >= new Date(evaluation.starts_at).getTime()) {
        throw new Error('Calibration fitting must finish before evaluation starts.');
      }
      const samples: CalibrationSample[] = [];
      for (const [partition, ids] of [
        ['training', plan.definition.trainingStudyIds],
        ['validation', plan.definition.validationStudyIds],
      ] as const) {
        for (const studyId of ids) {
          const evidence = this.buildVerificationStudyEvidenceInternal(studyId, new Date(input.fittedAt));
          if (!evidence.report.eligibleForPublication) {
            throw new Error(`Calibration ${partition} study ${studyId} did not pass its evidence gates.`);
          }
          samples.push(...evidence.pairs.map((pair): CalibrationSample => ({
            partition,
            studyId: pair.studyId,
            runId: pair.runId,
            targetId: pair.targetId,
            horizonMinutes: pair.horizonMinutes,
            probability: pair.rawCounterfactualProbability ?? pair.probability,
            observedRain: pair.observedRain,
            observedAt: pair.observedAt,
          })));
        }
      }
      const artifact = fitIsotonicCalibrationArtifact({
        planId: plan.definition.id,
        planSha256: plan.definition_sha256,
        artifactVersion: input.artifactVersion,
        fittedAt: input.fittedAt,
        algorithmVersion: plan.definition.algorithmVersion,
        domain: plan.definition.domain,
        product: plan.definition.product,
        evaluationStudyId: plan.definition.evaluationStudyId,
        evaluationStudySha256: evaluation.definition_sha256,
        horizonsMinutes: plan.definition.horizonsMinutes,
        minimumSamplesPerHorizon: plan.definition.minimumSamplesPerHorizon,
        maximumValidationBrierDegradation: plan.definition.maximumValidationBrierDegradation,
        minimumAggregateValidationBrierImprovement:
          plan.definition.minimumAggregateValidationBrierImprovement,
        samples,
      });
      const artifactJson = JSON.stringify(artifact);
      const result = this.database.query(`
        INSERT OR IGNORE INTO calibration_artifacts (
          id, plan_id, artifact_version, fitted_at, eligible_for_shadow_application,
          artifact_sha256, artifact_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        artifact.id,
        plan.definition.id,
        input.artifactVersion,
        input.fittedAt,
        artifact.eligibleForShadowApplication ? 1 : 0,
        artifact.sha256,
        artifactJson,
      );
      if (result.changes === 0) {
        const existing = this.database.query<{
          id: string;
          artifact_sha256: string;
          artifact_json: string;
        }, [string, string]>(`
          SELECT id, artifact_sha256, artifact_json
          FROM calibration_artifacts
          WHERE plan_id = ? AND artifact_version = ?
        `).get(plan.definition.id, input.artifactVersion);
        if (
          !existing
          || existing.id !== artifact.id
          || existing.artifact_sha256 !== artifact.sha256
          || existing.artifact_json !== artifactJson
        ) throw new Error('Calibration artifact version is already archived with different evidence.');
      }
      return { artifact, inserted: result.changes === 1 };
    }).immediate();
  }

  activateCalibrationArtifact(input: { artifactId: string; activatedAt: string }) {
    if (!isCanonicalIsoTimestamp(input.activatedAt)) {
      throw new Error('Calibration activation time must use canonical UTC ISO format.');
    }
    return this.database.transaction(() => {
      const row = this.database.query<{
        plan_id: string;
        fitted_at: string;
        eligible_for_shadow_application: number;
        evaluation_study_id: string;
        evaluation_starts_at: string;
      }, [string]>(`
        SELECT artifact.plan_id, artifact.fitted_at, artifact.eligible_for_shadow_application,
          plan.evaluation_study_id, study.starts_at AS evaluation_starts_at
        FROM calibration_artifacts artifact
        JOIN calibration_plans plan ON plan.id = artifact.plan_id
        JOIN verification_studies study ON study.id = plan.evaluation_study_id
        WHERE artifact.id = ?
      `).get(input.artifactId);
      if (!row) throw new Error('Calibration artifact is not archived.');
      if (row.eligible_for_shadow_application !== 1) {
        throw new Error('Calibration artifact did not pass validation gates.');
      }
      const activatedTime = new Date(input.activatedAt).getTime();
      if (activatedTime < new Date(row.fitted_at).getTime()) {
        throw new Error('Calibration artifact cannot be activated before it is fitted.');
      }
      if (activatedTime >= new Date(row.evaluation_starts_at).getTime()) {
        throw new Error('Calibration artifact must be activated before evaluation starts.');
      }
      const result = this.database.query(`
        INSERT OR IGNORE INTO calibration_evaluation_bindings (
          evaluation_study_id, plan_id, artifact_id, activated_at
        ) VALUES (?, ?, ?, ?)
      `).run(
        row.evaluation_study_id,
        row.plan_id,
        input.artifactId,
        input.activatedAt,
      );
      if (result.changes === 0) {
        const existing = this.database.query<{
          plan_id: string;
          artifact_id: string;
          activated_at: string;
        }, [string]>(`
          SELECT plan_id, artifact_id, activated_at
          FROM calibration_evaluation_bindings
          WHERE evaluation_study_id = ?
        `).get(row.evaluation_study_id);
        if (!existing || existing.plan_id !== row.plan_id || existing.artifact_id !== input.artifactId) {
          throw new Error('Evaluation study is already bound to a different calibration artifact.');
        }
        return {
          evaluationStudyId: row.evaluation_study_id,
          planId: row.plan_id,
          artifactId: input.artifactId,
          activatedAt: existing.activated_at,
          inserted: false,
        };
      }
      return {
        evaluationStudyId: row.evaluation_study_id,
        planId: row.plan_id,
        artifactId: input.artifactId,
        activatedAt: input.activatedAt,
        inserted: true,
      };
    }).immediate();
  }

  getEvaluationCalibrationArtifact(evaluationStudyId: string) {
    const binding = this.database.query<{ artifact_id: string }, [string]>(`
      SELECT artifact_id
      FROM calibration_evaluation_bindings
      WHERE evaluation_study_id = ?
    `).get(evaluationStudyId);
    return binding ? this.getCalibrationArtifact(binding.artifact_id) : null;
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
    if (new Set(input.inputFrameIds).size !== input.inputFrameIds.length) {
      throw new Error('Radar nowcast input frame IDs must be unique.');
    }
    if (
      !Number.isFinite(input.latitude)
      || !Number.isFinite(input.longitude)
      || input.latitude < -90
      || input.latitude > 90
      || input.longitude < -180
      || input.longitude > 180
    ) throw new Error('Radar nowcast run coordinates are invalid.');
    const frames = input.inputFrameIds.map((frameId) => this.database.query<{
      id: string;
      observed_at: string;
      domain: string;
      product: string;
    }, [string]>(`
      SELECT id, observed_at, domain, product FROM radar_frames WHERE id = ?
    `).get(frameId));
    if (frames.some((frame) => !frame)) throw new Error('Radar nowcast input frame is not archived.');
    const observedTimes = frames.map((frame) => new Date(frame!.observed_at).getTime());
    if (
      observedTimes.some((time) => !Number.isFinite(time))
      || observedTimes.some((time, index) => index > 0 && time <= observedTimes[index - 1]!)
    ) throw new Error('Radar nowcast input frames must be chronological.');
    if (frames.some((frame) => frame!.domain !== input.domain || frame!.product !== input.product)) {
      throw new Error('Radar nowcast input frames do not match the run source.');
    }
    const sourceTime = new Date(input.sourceDataTime).getTime();
    const issuedTime = new Date(input.issuedAt).getTime();
    if (!isCanonicalIsoTimestamp(input.sourceDataTime) || !isCanonicalIsoTimestamp(input.issuedAt)) {
      throw new Error('Radar nowcast run timestamps must use canonical UTC ISO format.');
    }
    if (!Number.isFinite(sourceTime) || sourceTime !== observedTimes.at(-1)) {
      throw new Error('Radar nowcast source time must match the newest input frame.');
    }
    if (!Number.isFinite(issuedTime) || issuedTime < sourceTime || issuedTime - sourceTime > 10 * 60_000) {
      throw new Error('Radar nowcast issuance requires fresh radar inputs.');
    }
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
      definition_sha256: string;
      definition_json: string;
    }, [string]>(`
      SELECT starts_at, ends_at, algorithm_version, domain, product, issue_cadence_minutes,
        definition_sha256, definition_json
      FROM verification_studies WHERE id = ?
    `).get(input.studyId);
    if (!study) throw new Error('Verification study is not registered.');
    const evaluationPlan = this.database.query<{ id: string }, [string]>(`
      SELECT id FROM calibration_plans WHERE evaluation_study_id = ?
    `).get(input.studyId);
    const evaluationArtifact = this.getEvaluationCalibrationArtifact(input.studyId);
    const parsedResponses = input.runs.map(({ run }) => radarNowcastSchema.parse(run.response));
    if (evaluationPlan) {
      if (!evaluationArtifact) {
        throw new Error('Calibration evaluation issuance requires a bound calibration artifact.');
      }
      if (parsedResponses.some((response) => (
        response.calibrationStatus !== 'provisional'
        || response.calibration?.artifactId !== evaluationArtifact.id
        || response.calibration?.artifactSha256 !== evaluationArtifact.sha256
        || response.calibration?.method !== evaluationArtifact.method
      ))) throw new Error('Calibration evaluation run does not use its bound calibration artifact.');
      parsedResponses.forEach((response) => verifyAppliedCalibration(response, evaluationArtifact));
    } else if (parsedResponses.some((response) => response.calibrationStatus !== 'uncalibrated')) {
      throw new Error('Provisional calibration is only valid for its bound evaluation study.');
    }
    const scheduledTime = new Date(input.scheduledAt).getTime();
    const issuedTime = new Date(input.issuedAt).getTime();
    const startTime = new Date(study.starts_at).getTime();
    const endTime = new Date(study.ends_at).getTime();
    const cadenceMs = study.issue_cadence_minutes * 60_000;
    if (
      !isCanonicalIsoTimestamp(input.scheduledAt)
      || !isCanonicalIsoTimestamp(input.issuedAt)
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
    const inputFrameSequences = new Set(input.runs.map(({ run }) => JSON.stringify(run.inputFrameIds)));
    if (inputFrameSequences.size !== 1) throw new Error('Study batch runs must use the same ordered radar input frames.');
    const registeredDefinitionSha256 = createHash('sha256').update(study.definition_json).digest('hex');
    if (registeredDefinitionSha256 !== study.definition_sha256) {
      throw new Error('Verification study definition checksum is invalid.');
    }
    const registeredDefinition = parseStoredStudyDefinition(JSON.parse(study.definition_json)).definition;
    if (input.runs.some(({ run }) => run.inputFrameIds.length !== registeredDefinition.inputFrameCount)) {
      throw new Error('Study runs must use the registered input frame count.');
    }
    if (parsedResponses.some((response) => response.ensembleMembers !== registeredDefinition.ensembleMembers)) {
      throw new Error('Study runs must use the registered ensemble member count.');
    }
    input.runs.forEach(({ targetId, run }, index) => {
      const response = parsedResponses[index]!;
      if (
        run.algorithmVersion !== study.algorithm_version
        || run.domain !== study.domain
        || run.product !== study.product
        || response.algorithmVersion !== run.algorithmVersion
        || response.product !== run.product
      ) throw new Error(`Study run for target ${targetId} has provenance that does not match the registered algorithm and source.`);
      if (locationCell(run.latitude, run.longitude) !== targets[index]?.location_cell) {
        throw new Error(`Study run for target ${targetId} location does not match its frozen target.`);
      }
      const inputSha256 = run.inputFrameIds.map((frameId) => this.database.query<{
        sha256: string;
      }, [string]>(`
        SELECT asset.sha256
        FROM radar_frames frame
        JOIN source_assets asset ON asset.id = frame.source_asset_id
        WHERE frame.id = ?
      `).get(frameId)?.sha256);
      if (inputSha256.some((checksum) => checksum === undefined)) {
        throw new Error(`Study run for target ${targetId} references an unavailable radar source asset.`);
      }
      validateRadarNowcastProvenance(response, {
        latitude: run.latitude,
        longitude: run.longitude,
        sourceDataTime: run.sourceDataTime,
        inputSha256: inputSha256 as string[],
      });
      const sourceTime = new Date(run.sourceDataTime).getTime();
      if (!Number.isFinite(sourceTime) || sourceTime > issuedTime) {
        throw new Error(`Study run for target ${targetId} source time must not be later than issuance.`);
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

  private buildVerificationStudyEvidenceInternal(studyId: string, asOf: Date) {
    if (!Number.isFinite(asOf.getTime())) throw new Error('Study report cutoff is invalid.');
    const study = this.database.query<{
      registered_at: string;
      definition_sha256: string;
      definition_json: string;
    }, [string]>(`
      SELECT registered_at, definition_sha256, definition_json
      FROM verification_studies WHERE id = ?
    `).get(studyId);
    if (!study) throw new Error('Verification study is not registered.');
    const storedDefinitionSha256 = createHash('sha256').update(study.definition_json).digest('hex');
    if (storedDefinitionSha256 !== study.definition_sha256) {
      throw new Error('Verification study definition checksum is invalid.');
    }
    const {
      definition,
      reportPolicyPreregistered,
      runtimeParametersPreregistered,
    } = parseStoredStudyDefinition(JSON.parse(study.definition_json));
    const targets = this.database.query<{ id: string }, [string]>(`
      SELECT target_id AS id
      FROM verification_study_targets
      WHERE study_id = ?
      ORDER BY sequence
    `).all(studyId).map((target) => target.id);
    const runs = this.database.query<{
      run_id: string;
      target_id: string;
      scheduled_at: string;
      issued_at: string;
      response_json: string;
    }, [string]>(`
      SELECT link.run_id, link.target_id, link.scheduled_at, link.issued_at, run.response_json
      FROM verification_study_radar_runs link
      JOIN radar_nowcast_runs run ON run.id = link.run_id
      WHERE link.study_id = ?
      ORDER BY link.scheduled_at, link.target_id
    `).all(studyId).map((run): StudyVerificationRun => ({
      runId: run.run_id,
      targetId: run.target_id,
      scheduledAt: run.scheduled_at,
      issuedAt: run.issued_at,
      response: JSON.parse(run.response_json),
    }));
    const observations = this.database.query<{
      id: string;
      target_id: string;
      observed_at: string;
      rain_observed: number;
    }, [string, string]>(`
      SELECT observation.id, json_extract(observation.payload_json, '$.icaoId') AS target_id,
        observation.observed_at, observation.rain_observed
      FROM rain_observations observation
      JOIN verification_study_targets target
        ON target.study_id = ?
        AND target.target_id = json_extract(observation.payload_json, '$.icaoId')
      WHERE observation.source = 'aviation-weather-metar'
        AND observation.quality = 'verified'
        AND observation.observed_at < ?
      ORDER BY target.sequence, observation.observed_at, observation.id
    `).all(studyId, new Date(Math.min(asOf.getTime(), new Date(definition.endsAt).getTime())).toISOString())
      .map((observation): StudyVerificationObservation => ({
        id: observation.id,
        targetId: observation.target_id,
        observedAt: observation.observed_at,
        rainObserved: observation.rain_observed === 1,
      }));
    const calibrationBinding = this.database.query<{
      plan_id: string;
      artifact_id: string;
    }, [string]>(`
      SELECT plan_id, artifact_id
      FROM calibration_evaluation_bindings
      WHERE evaluation_study_id = ?
    `).get(studyId);
    let calibrationEvaluationPolicy:
      Parameters<typeof computeVerificationStudyEvidence>[0]['calibrationEvaluationPolicy'];
    if (calibrationBinding) {
      const plan = this.getCalibrationPlan(calibrationBinding.plan_id);
      const artifact = this.getCalibrationArtifact(calibrationBinding.artifact_id);
      if (!plan || !artifact || artifact.evaluationStudyId !== studyId) {
        throw new Error('Calibration evaluation binding provenance is invalid.');
      }
      calibrationEvaluationPolicy = {
        artifactId: artifact.id,
        artifactSha256: artifact.sha256,
        maximumHoldoutBrierDegradation: plan.definition.maximumHoldoutBrierDegradation,
        minimumAggregateHoldoutBrierImprovement:
          plan.definition.minimumAggregateHoldoutBrierImprovement,
      };
    }
    return computeVerificationStudyEvidence({
      definition,
      definitionSha256: study.definition_sha256,
      registeredAt: study.registered_at,
      targetIds: targets,
      runs,
      observations,
      asOf,
      reportPolicyPreregistered,
      runtimeParametersPreregistered,
      calibrationEvaluationPolicy,
    });
  }

  private buildVerificationStudyReportInternal(studyId: string, asOf: Date) {
    return this.buildVerificationStudyEvidenceInternal(studyId, asOf).report;
  }

  buildVerificationStudyReport(studyId: string, asOf: Date) {
    return this.database.transaction(() => this.buildVerificationStudyReportInternal(studyId, asOf))();
  }

  saveVerificationStudyReport(input: { studyId: string; reportVersion: string; asOf: Date }) {
    if (!/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(input.reportVersion)) {
      throw new Error('Study report version is invalid.');
    }
    return this.database.transaction(() => {
      const report = this.buildVerificationStudyReportInternal(input.studyId, input.asOf);
      const reportJson = JSON.stringify(report);
      const reportSha256 = createHash('sha256').update(reportJson).digest('hex');
      const result = this.database.query(`
        INSERT OR IGNORE INTO verification_study_reports (
          study_id, report_version, generated_at, eligible_for_publication,
          report_sha256, report_json
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        input.studyId,
        input.reportVersion,
        report.generatedAt,
        report.eligibleForPublication ? 1 : 0,
        reportSha256,
        reportJson,
      );
      if (result.changes === 0) {
        const existing = this.database.query<{
          report_sha256: string;
          report_json: string;
        }, [string, string]>(`
          SELECT report_sha256, report_json
          FROM verification_study_reports
          WHERE study_id = ? AND report_version = ?
        `).get(input.studyId, input.reportVersion);
        if (!existing || existing.report_sha256 !== reportSha256 || existing.report_json !== reportJson) {
          throw new Error('Study report version is already archived with different evidence.');
        }
      }
      return { reportVersion: input.reportVersion, reportSha256, inserted: result.changes === 1, report };
    }).immediate();
  }

  listVerificationStudyReports(studyId: string) {
    return this.database.query<{
      report_version: string;
      generated_at: string;
      eligible_for_publication: number;
      report_sha256: string;
      report_json: string;
    }, [string]>(`
      SELECT report_version, generated_at, eligible_for_publication, report_sha256, report_json
      FROM verification_study_reports
      WHERE study_id = ?
      ORDER BY generated_at, report_version
    `).all(studyId);
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
