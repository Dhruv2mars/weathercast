import { ForecastArchive } from '../archive';

const through = process.argv[2] ? new Date(process.argv[2]) : new Date();
if (Number.isNaN(through.getTime())) throw new Error('Usage: bun run api:verify [ISO-through-time] [verification-version]');
const verificationVersion = process.argv[3] ?? 'brier-v1';
const archive = new ForecastArchive(process.env.DATABASE_PATH ?? '.data/weathercast.sqlite');

try {
  console.info(JSON.stringify(archive.verifyBrier(verificationVersion, through)));
} finally {
  archive.close();
}
