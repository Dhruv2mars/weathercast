import { createHandler } from './app';
import { loadConfig } from './config';
import { NormalizedHttpProvider, OpenMeteoEvaluationProvider } from './providers';
import { createWeathercastStore } from './store-factory';

const config = loadConfig();
const archive = await createWeathercastStore(config);
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
