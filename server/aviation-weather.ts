import { z } from 'zod';

import type { RainObservationInput } from './archive';
import type { PrecisionIngestionStore } from './precision-ingestion-store';

const metarSchema = z.object({
  icaoId: z.string().min(4),
  receiptTime: z.string().min(1),
  obsTime: z.number().int().positive(),
  reportTime: z.string().min(1),
  wxString: z.string().nullable().optional(),
  precip: z.number().nonnegative().nullable().optional(),
  rawOb: z.string().min(1),
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
  name: z.string().optional(),
  qcField: z.number().optional(),
}).passthrough();

const metarBatchSchema = z.array(metarSchema);

function isRainWeatherToken(token: string) {
  const normalized = token.toUpperCase().replace(/^[+-]/, '');
  return /^(?:(?:MI|PR|BC|DR|BL|SH|TS|FZ))?(?:RA|DZ)/.test(normalized);
}

export function metarReportsRain(weather: string | null | undefined) {
  return weather?.trim().split(/\s+/).some(isRainWeatherToken) ?? false;
}

export function validateMetarUserAgent(userAgent: string, production: boolean) {
  if (userAgent.trim().length < 10) throw new Error('WEATHERCAST_USER_AGENT must identify the application.');
  if (production && (!/contact=\S+|[\w.+-]+@[\w.-]+/i.test(userAgent) || /invalid|development/i.test(userAgent))) {
    throw new Error('Production WEATHERCAST_USER_AGENT must identify Weathercast and a monitored contact.');
  }
  return userAgent;
}

export function parseMetarObservations(value: unknown): RainObservationInput[] {
  return metarBatchSchema.parse(value).map((metar) => ({
    source: 'aviation-weather-metar',
    sourceEventId: `${metar.icaoId}:${metar.obsTime}`,
    observedAt: new Date(metar.obsTime * 1000).toISOString(),
    latitude: metar.lat,
    longitude: metar.lon,
    rainObserved: metarReportsRain(metar.wxString),
    accumulationMm: metar.precip == null ? undefined : metar.precip * 25.4,
    quality: 'verified',
    truthResolutionSeconds: 3_600,
    onsetPublishable: false,
    payload: metar,
  }));
}

export function parseMetarBytes(raw: Uint8Array) {
  if (raw.byteLength === 0) return [];
  return parseMetarObservations(JSON.parse(new TextDecoder().decode(raw)));
}

export async function archiveMetarBatch(
  archive: Pick<PrecisionIngestionStore, 'archiveSourceAsset' | 'archiveObservationBatch'>,
  input: { stationIds: string[]; retrievedAt: string; raw: Uint8Array },
) {
  const upstreamKey = `metar:${input.stationIds.join(',')}:${input.retrievedAt}`;
  const assetInput = {
    provider: 'aviation-weather-metar',
    upstreamKey,
    retrievedAt: input.retrievedAt,
    mediaType: 'application/json',
    bytes: input.raw,
  };
  let observations: RainObservationInput[];
  try {
    observations = parseMetarBytes(input.raw);
  } catch (error) {
    await archive.archiveSourceAsset(assetInput);
    throw error;
  }
  return archive.archiveObservationBatch({ asset: assetInput, observations });
}

export class AviationWeatherMetarAdapter {
  constructor(
    private readonly userAgent: string,
    private readonly baseUrl = 'https://aviationweather.gov/api/data/metar',
  ) {}

  async fetchRaw(stationIds: string[], signal: AbortSignal) {
    if (stationIds.length === 0 || stationIds.length > 400) {
      throw new Error('METAR ingestion requires between 1 and 400 station IDs.');
    }
    if (stationIds.some((station) => !/^[A-Z0-9]{4}$/.test(station))) {
      throw new Error('METAR station IDs must be four-character ICAO identifiers.');
    }
    const params = new URLSearchParams({ ids: stationIds.join(','), format: 'json', hours: '2' });
    const response = await fetch(`${this.baseUrl}?${params}`, {
      headers: { Accept: 'application/json', 'User-Agent': this.userAgent },
      signal,
    });
    const retrievedAt = new Date().toISOString();
    if (response.status === 204) {
      return { retrievedAt, raw: new Uint8Array() };
    }
    if (!response.ok) throw new Error(`AviationWeather returned ${response.status}.`);
    const raw = new Uint8Array(await response.arrayBuffer());
    return { retrievedAt, raw };
  }
}
