import { archiveMetarBatch, AviationWeatherMetarAdapter, validateMetarUserAgent } from '../aviation-weather';
import { ForecastArchive } from '../archive';

const stationIds = (process.env.METAR_STATION_IDS ?? '')
  .split(',')
  .map((station) => station.trim().toUpperCase())
  .filter(Boolean);
if (stationIds.length === 0) throw new Error('METAR_STATION_IDS is required.');

const userAgent = process.env.WEATHERCAST_USER_AGENT ?? 'Weathercast-Development/1.0 contact=dev@weathercast.invalid';
const adapter = new AviationWeatherMetarAdapter(validateMetarUserAgent(userAgent, process.env.NODE_ENV === 'production'));
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 15_000);
const archive = new ForecastArchive(process.env.DATABASE_PATH ?? '.data/weathercast.sqlite');

try {
  const result = await adapter.fetchRaw(stationIds, controller.signal);
  const archived = archiveMetarBatch(archive, { stationIds, ...result });
  console.info(JSON.stringify({
    sourceAssetId: archived.asset.id,
    sha256: archived.asset.sha256,
    observationsAccepted: archived.observationsAccepted,
  }));
} finally {
  clearTimeout(timeout);
  archive.close();
}
