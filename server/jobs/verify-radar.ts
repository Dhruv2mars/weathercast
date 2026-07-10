import { ForecastArchive } from '../archive';

const through = new Date(process.argv[2] ?? Date.now());
if (Number.isNaN(through.getTime())) throw new Error('Verification cutoff must be an ISO timestamp.');
const version = process.argv[3] ?? 'radar-brier-v1';
if (!/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(version)) throw new Error('Verification version is invalid.');

const archive = new ForecastArchive(process.env.DATABASE_PATH ?? '.data/weathercast.sqlite');
try {
  console.info(JSON.stringify({ version, through: through.toISOString(), ...archive.verifyRadarBrier(version, through) }));
} finally {
  archive.close();
}
