import { SQL } from 'bun';
import { join } from 'node:path';

import type { NowcastEnvelope } from './archive';
import type { ForecastIssueInput, ForecastStore } from './forecast-store';
import type { ArchivedRadarFrame } from './study-issuance';

type JsonValue = string | NowcastEnvelope;

function parseEnvelope(value: JsonValue): NowcastEnvelope {
  return typeof value === 'string' ? JSON.parse(value) as NowcastEnvelope : value;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export class PostgresForecastStore implements ForecastStore {
  private constructor(private readonly sql: SQL) {}

  static async create(databaseUrl: string) {
    const sql = new SQL(databaseUrl);
    try {
      await sql.file(join(import.meta.dir, 'postgres', '001_serving.sql'));
      return new PostgresForecastStore(sql);
    } catch (error) {
      await sql.close({ timeout: 0 });
      throw error;
    }
  }

  async isReady() {
    try {
      await this.sql.begin(async (transaction) => {
        await transaction`INSERT INTO readiness_probes (id, checked_at)
          VALUES (1, NOW()) ON CONFLICT (id) DO UPDATE SET checked_at = EXCLUDED.checked_at`;
        await transaction`DELETE FROM readiness_probes WHERE id = 1`;
      });
      return true;
    } catch {
      return false;
    }
  }

  async findFresh(cell: string, now: Date) {
    const rows = await this.sql<Array<{ response_json: JsonValue }>>`
      SELECT response_json FROM forecast_issues
      WHERE location_cell = ${cell} AND valid_until > ${now}
      ORDER BY generated_at DESC LIMIT 1
    `;
    return rows[0] ? parseEnvelope(rows[0].response_json) : null;
  }

  async save(input: ForecastIssueInput) {
    const response = JSON.stringify(input.envelope);
    await this.sql`
      INSERT INTO forecast_issues (
        id, issued_at, generated_at, valid_until, location_cell, latitude, longitude,
        provider, upstream_run_id, response_json
      ) VALUES (
        ${input.envelope.forecastId}, ${input.envelope.generatedAt}, ${input.envelope.generatedAt},
        ${input.envelope.validUntil}, ${input.cell}, ${input.latitude}, ${input.longitude},
        ${input.provider}, ${input.upstreamRunId ?? null}, ${response}::jsonb
      ) ON CONFLICT (id) DO NOTHING
    `;
    const rows = await this.sql<Array<{ response_json: JsonValue }>>`
      SELECT response_json FROM forecast_issues WHERE id = ${input.envelope.forecastId}
    `;
    if (!rows[0]) throw new Error('PostgreSQL archive did not retain the forecast issue.');
    return parseEnvelope(rows[0].response_json);
  }

  async listRadarFrames(domain: string, product: string, limit = 4): Promise<ArchivedRadarFrame[]> {
    const rows = await this.sql<Array<{
      id: string;
      observed_at: Date | string;
      retrieved_at: Date | string;
      object_key: string;
      source_asset_id: string;
    }>>`
      SELECT id, observed_at, retrieved_at, object_key, source_asset_id
      FROM radar_frames WHERE domain = ${domain} AND product = ${product}
      ORDER BY observed_at DESC LIMIT ${limit}
    `;
    return rows.map((row) => ({ ...row, observed_at: iso(row.observed_at), retrieved_at: iso(row.retrieved_at) }));
  }

  async countRecentVerifiedObservationStations(source: string, since: string, through: string) {
    const rows = await this.sql<Array<{ station_count: number | string }>>`
      SELECT COUNT(DISTINCT payload_json ->> 'icaoId') AS station_count
      FROM rain_observations
      WHERE source = ${source} AND quality = 'verified'
        AND observed_at >= ${since} AND observed_at <= ${through}
    `;
    return Number(rows[0]?.station_count ?? 0);
  }

  async close() {
    await this.sql.close({ timeout: 0 });
  }
}
