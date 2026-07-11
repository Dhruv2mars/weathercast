import { ForecastArchive } from './archive';
import { createHandler } from './app';
import { loadConfig } from './config';
import type { ForecastStore } from './forecast-store';
import { PostgresForecastStore } from './postgres-forecast-store';
import { NormalizedHttpProvider, OpenMeteoEvaluationProvider } from './providers';

const config = loadConfig();
const archive: ForecastStore = config.ARCHIVE_MODE === 'postgres'
  ? await PostgresForecastStore.create(config.DATABASE_URL!)
  : new ForecastArchive(config.DATABASE_PATH);
const provider = config.NOWCAST_PROVIDER_MODE === 'normalized-upstream'
  ? new NormalizedHttpProvider(
      config.NORMALIZED_UPSTREAM_URL!,
      config.NORMALIZED_UPSTREAM_HEALTH_URL!,
      config.NORMALIZED_UPSTREAM_TOKEN!,
    )
  : new OpenMeteoEvaluationProvider(config.OPEN_METEO_API_HOST);

const server = Bun.serve({
  port: config.PORT,
  fetch: createHandler({ config, archive, provider }),
});

console.info(`Weathercast API listening on ${server.url}`);

async function shutdown() {
  await archive.close();
  void server.stop();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
