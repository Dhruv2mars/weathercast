import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Nowcast } from '@/types/weather';

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
  payload: unknown;
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
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.database.exec(`
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
        rain_observed INTEGER NOT NULL CHECK (rain_observed IN (0, 1)),
        rain_rate_mm_hour REAL,
        accumulation_mm REAL,
        quality TEXT NOT NULL CHECK (quality IN ('provisional', 'verified', 'rejected')),
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
    `);
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
        rain_observed, rain_rate_mm_hour, accumulation_mm, quality, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.source,
      input.sourceEventId,
      input.observedAt,
      cell,
      Number(input.latitude.toFixed(4)),
      Number(input.longitude.toFixed(4)),
      input.rainObserved ? 1 : 0,
      input.rainRateMmHour ?? null,
      input.accumulationMm ?? null,
      input.quality,
      JSON.stringify(input.payload),
    );
    return id;
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
        ) VALUES (?, 'brier', ?, ?, ?, 1, ?)
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
