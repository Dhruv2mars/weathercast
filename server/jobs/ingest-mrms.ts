import { ForecastArchive } from '../archive';
import { ingestMrmsFrames, MrmsAdapter, type MrmsDomain, type MrmsProduct } from '../mrms';

const domain = (process.env.MRMS_DOMAIN ?? 'CONUS') as MrmsDomain;
const product = (process.env.MRMS_PRODUCT ?? 'PrecipRate_00.00') as MrmsProduct;
if (domain !== 'CONUS') throw new Error('This milestone supports the CONUS MRMS domain only.');
if (!['PrecipRate_00.00', 'RadarQualityIndex_00.00'].includes(product)) throw new Error('Unsupported MRMS product.');
const frameCount = Number(process.env.MRMS_FRAME_COUNT ?? 8);
if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > 30) {
  throw new Error('MRMS_FRAME_COUNT must be an integer from 1 through 30.');
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 60_000);
const archive = new ForecastArchive(process.env.DATABASE_PATH ?? '.data/weathercast.sqlite');
const adapter = new MrmsAdapter(process.env.WEATHERCAST_USER_AGENT ?? 'Weathercast-Development/1.0 contact=dev@weathercast.invalid');

try {
  const result = await ingestMrmsFrames({
    archive,
    adapter,
    domain,
    product,
    now: new Date(),
    frameCount,
    signal: controller.signal,
  });
  const frames = archive.listRadarFrames(domain, product, frameCount);
  const newest = frames[0]?.observed_at ?? null;
  const ageMinutes = newest ? Math.round((Date.now() - new Date(newest).getTime()) / 60_000) : null;
  console.info(JSON.stringify({ ...result, newest, ageMinutes }));
  if (ageMinutes === null || ageMinutes > 10) process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  archive.close();
}
