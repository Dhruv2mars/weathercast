import { ForecastArchive } from '../archive';
import { parseCanonicalUtcTimestamp } from '../canonical-time';

const artifactId = process.argv[2];
if (!artifactId) throw new Error('Usage: bun run api:activate-calibration <artifact-id> [activation-time]');
const activatedAt = process.argv[3]
  ? parseCanonicalUtcTimestamp(process.argv[3], 'Calibration activation time')
  : new Date().toISOString();
const archive = new ForecastArchive(process.env.DATABASE_PATH ?? '.data/weathercast.sqlite');

try {
  console.info(JSON.stringify(archive.activateCalibrationArtifact({
    artifactId,
    activatedAt,
  })));
} finally {
  archive.close();
}
