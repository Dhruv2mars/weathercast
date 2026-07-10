import { ForecastArchive } from '../archive';

const studyId = process.argv[2];
if (!studyId) throw new Error('Usage: bun run api:report-study <study-id> [cutoff] [report-version]');
const asOf = new Date(process.argv[3] ?? Date.now());
if (Number.isNaN(asOf.getTime())) throw new Error('Study report cutoff must be an ISO timestamp.');
const reportVersion = process.argv[4] ?? `preliminary-${asOf.toISOString().replaceAll(/[-:.]/g, '')}`;
const archive = new ForecastArchive(process.env.DATABASE_PATH ?? '.data/weathercast.sqlite');

try {
  console.info(JSON.stringify(archive.saveVerificationStudyReport({ studyId, reportVersion, asOf })));
} finally {
  archive.close();
}
