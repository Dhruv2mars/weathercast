import { ForecastArchive } from '../archive';

const artifactId = process.argv[2];
if (!artifactId) throw new Error('Usage: bun run api:activate-calibration <artifact-id> [activation-time]');
const activatedAt = new Date(process.argv[3] ?? Date.now());
if (Number.isNaN(activatedAt.getTime())) throw new Error('Calibration activation time must be an ISO timestamp.');
const archive = new ForecastArchive(process.env.DATABASE_PATH ?? '.data/weathercast.sqlite');

try {
  console.info(JSON.stringify(archive.activateCalibrationArtifact({
    artifactId,
    activatedAt: activatedAt.toISOString(),
  })));
} finally {
  archive.close();
}
