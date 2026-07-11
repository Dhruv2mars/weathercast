import { ForecastArchive } from '../archive';
import { calibrationPlanSchema } from '../calibration-contract';

const path = process.argv[2];
if (!path) throw new Error('Usage: bun run api:register-calibration <definition.json>');
const definition = calibrationPlanSchema.parse(await Bun.file(path).json());
const archive = new ForecastArchive(process.env.DATABASE_PATH ?? '.data/weathercast.sqlite');

try {
  console.info(JSON.stringify(archive.registerCalibrationPlan({
    definition,
    registeredAt: new Date().toISOString(),
  })));
} finally {
  archive.close();
}
