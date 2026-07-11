import { SQL } from 'bun';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import type { NowcastEnvelope, RainObservationInput, SourceAssetInput } from './archive';
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
    await this.sql`
      INSERT INTO forecast_issues (
        id, issued_at, generated_at, valid_until, location_cell, latitude, longitude,
        provider, upstream_run_id, response_json
      ) VALUES (
        ${input.envelope.forecastId}, ${input.envelope.issuedAt}, ${input.envelope.generatedAt},
        ${input.envelope.validUntil}, ${input.cell}, ${input.latitude}, ${input.longitude},
        ${input.provider}, ${input.upstreamRunId ?? null}, ${input.envelope}
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

  async archiveSourceAsset(input: SourceAssetInput) {
    const sha256 = createHash('sha256').update(input.bytes).digest('hex');
    const id = sha256.slice(0, 24);
    await this.sql`
      INSERT INTO source_assets (
        id, provider, upstream_key, retrieved_at, sha256, media_type, byte_length, payload
      ) VALUES (
        ${id}, ${input.provider}, ${input.upstreamKey}, ${input.retrievedAt}, ${sha256},
        ${input.mediaType}, ${input.bytes.byteLength}, ${input.bytes}
      ) ON CONFLICT (id) DO NOTHING
    `;
    const rows = await this.sql<Array<{ sha256: string }>>`
      SELECT sha256 FROM source_assets WHERE id = ${id}
    `;
    if (rows[0]?.sha256 !== sha256) throw new Error('Source asset content identifier collision.');
    return { id, sha256 };
  }

  async archiveRadarFrame(input: {
    asset: SourceAssetInput;
    frame: {
      domain: string;
      product: string;
      observedAt: string;
      retrievedAt: string;
      objectKey: string;
    };
  }) {
    const sha256 = createHash('sha256').update(input.asset.bytes).digest('hex');
    const assetId = sha256.slice(0, 24);
    const frameId = createHash('sha256').update(JSON.stringify({
      domain: input.frame.domain,
      product: input.frame.product,
      observedAt: input.frame.observedAt,
    })).digest('hex').slice(0, 24);
    await this.sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO source_assets (
          id, provider, upstream_key, retrieved_at, sha256, media_type, byte_length, payload
        ) VALUES (
          ${assetId}, ${input.asset.provider}, ${input.asset.upstreamKey}, ${input.asset.retrievedAt},
          ${sha256}, ${input.asset.mediaType}, ${input.asset.bytes.byteLength}, ${input.asset.bytes}
        ) ON CONFLICT (id) DO NOTHING
      `;
      await transaction`
        INSERT INTO radar_frames (
          id, domain, product, observed_at, retrieved_at, object_key, source_asset_id
        ) VALUES (
          ${frameId}, ${input.frame.domain}, ${input.frame.product}, ${input.frame.observedAt},
          ${input.frame.retrievedAt}, ${input.frame.objectKey}, ${assetId}
        ) ON CONFLICT (id) DO NOTHING
      `;
    });
    return { asset: { id: assetId, sha256 }, frameId };
  }

  async archiveObservationBatch(input: {
    asset: SourceAssetInput;
    observations: RainObservationInput[];
  }) {
    const sha256 = createHash('sha256').update(input.asset.bytes).digest('hex');
    const assetId = sha256.slice(0, 24);
    await this.sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO source_assets (
          id, provider, upstream_key, retrieved_at, sha256, media_type, byte_length, payload
        ) VALUES (
          ${assetId}, ${input.asset.provider}, ${input.asset.upstreamKey}, ${input.asset.retrievedAt},
          ${sha256}, ${input.asset.mediaType}, ${input.asset.bytes.byteLength}, ${input.asset.bytes}
        ) ON CONFLICT (id) DO NOTHING
      `;
      for (const observation of input.observations) {
        const id = createHash('sha256').update(JSON.stringify({
          source: observation.source,
          sourceEventId: observation.sourceEventId,
        })).digest('hex').slice(0, 24);
        const cell = `${observation.latitude.toFixed(4)},${observation.longitude.toFixed(4)}`;
        await transaction`
          INSERT INTO rain_observations (
            id, source, source_event_id, observed_at, location_cell, latitude, longitude,
            source_asset_id, rain_observed, rain_rate_mm_hour, accumulation_mm, quality,
            truth_resolution_seconds, onset_publishable, payload_json
          ) VALUES (
            ${id}, ${observation.source}, ${observation.sourceEventId}, ${observation.observedAt},
            ${cell}, ${Number(observation.latitude.toFixed(4))}, ${Number(observation.longitude.toFixed(4))},
            ${assetId}, ${observation.rainObserved}, ${observation.rainRateMmHour ?? null},
            ${observation.accumulationMm ?? null}, ${observation.quality},
            ${observation.truthResolutionSeconds ?? 3600}, ${observation.onsetPublishable ?? false},
            ${observation.payload as Record<string, unknown>}
          ) ON CONFLICT (id) DO NOTHING
        `;
      }
    });
    return { asset: { id: assetId, sha256 }, observationsAccepted: input.observations.length };
  }

  async close() {
    await this.sql.close({ timeout: 0 });
  }
}
