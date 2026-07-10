import { ForecastArchive } from '../archive';
import { observationBatchSchema } from '../observation-contract';

const inputPath = process.argv[2];
if (!inputPath) throw new Error('Usage: bun run api:ingest-observations <observations.json>');

const raw = await Bun.file(inputPath).json();
const observations = observationBatchSchema.parse(raw);
const archive = new ForecastArchive(process.env.DATABASE_PATH ?? '.data/weathercast.sqlite');

try {
  observations.forEach((observation) => archive.saveObservation(observation));
  console.info(JSON.stringify({ observationsAccepted: observations.length }));
} finally {
  archive.close();
}
