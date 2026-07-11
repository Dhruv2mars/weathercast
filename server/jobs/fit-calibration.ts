import { ForecastArchive } from '../archive';
import { parseCanonicalUtcTimestamp } from '../canonical-time';

const planId = process.argv[2];
const artifactVersion = process.argv[3];
const fitTime = process.argv[4];
if (!planId || !artifactVersion || !fitTime) {
  throw new Error('Usage: bun run api:fit-calibration <plan-id> <artifact-version> <fit-time>');
}
const fittedAt = parseCanonicalUtcTimestamp(fitTime, 'Calibration fit time');
const archive = new ForecastArchive(process.env.DATABASE_PATH ?? '.data/weathercast.sqlite');

try {
  console.info(JSON.stringify(archive.fitCalibrationPlan({
    planId,
    artifactVersion,
    fittedAt,
  })));
} finally {
  archive.close();
}
