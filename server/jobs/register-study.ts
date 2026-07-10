import { ForecastArchive } from '../archive';
import { studyDefinitionSchema } from '../study-contract';

const path = process.argv[2];
if (!path) throw new Error('Usage: bun run api:register-study <definition.json>');
const definition = studyDefinitionSchema.parse(await Bun.file(path).json());
const archive = new ForecastArchive(process.env.DATABASE_PATH ?? '.data/weathercast.sqlite');

try {
  const latestTargets = archive.listLatestMetarTargets();
  const byId = new Map(latestTargets.map((target) => [target.id, target]));
  const missing = definition.stationIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new Error(`No verified METAR coordinates are archived for: ${missing.join(', ')}.`);
  }
  const stale = definition.stationIds.filter((id) => (
    Date.now() - new Date(byId.get(id)!.observed_at).getTime() > 24 * 60 * 60_000
  ));
  if (stale.length > 0) throw new Error(`Latest METAR coordinates are older than 24 hours for: ${stale.join(', ')}.`);
  const targets = definition.stationIds.map((id) => {
    const target = byId.get(id)!;
    return { id, latitude: target.latitude, longitude: target.longitude };
  });
  const registeredAt = new Date().toISOString();
  console.info(JSON.stringify(archive.registerVerificationStudy({ definition, registeredAt, targets })));
} finally {
  archive.close();
}
