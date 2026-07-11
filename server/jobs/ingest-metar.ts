import { archiveMetarBatch, AviationWeatherMetarAdapter, validateMetarUserAgent } from '../aviation-weather';
import { loadConfig } from '../config';
import { createWeathercastStore } from '../store-factory';

const stationIds = (process.env.METAR_STATION_IDS ?? '')
  .split(',')
  .map((station: string) => station.trim().toUpperCase())
  .filter(Boolean);
if (stationIds.length === 0) throw new Error('METAR_STATION_IDS is required.');

const userAgent = process.env.WEATHERCAST_USER_AGENT ?? 'Weathercast-Development/1.0 contact=dev@weathercast.invalid';
const adapter = new AviationWeatherMetarAdapter(validateMetarUserAgent(userAgent, process.env.NODE_ENV === 'production'));
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 15_000);
const archive = await createWeathercastStore(loadConfig());

try {
  const result = await adapter.fetchRaw(stationIds, controller.signal);
  const archived = await archiveMetarBatch(archive, { stationIds, ...result });
  console.info(JSON.stringify({
    sourceAssetId: archived.asset.id,
    sha256: archived.asset.sha256,
    observationsAccepted: archived.observationsAccepted,
  }));
} finally {
  clearTimeout(timeout);
  await archive.close();
}
