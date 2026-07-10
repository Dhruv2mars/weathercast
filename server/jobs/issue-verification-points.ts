import { ForecastArchive } from '../archive';

const endpoint = process.env.NOWCAST_API_URL;
if (!endpoint) throw new Error('NOWCAST_API_URL is required.');
const parsedEndpoint = new URL(endpoint);
if (!['http:', 'https:'].includes(parsedEndpoint.protocol)) throw new Error('NOWCAST_API_URL must be HTTP or HTTPS.');
if (process.env.NODE_ENV === 'production' && parsedEndpoint.protocol !== 'https:') {
  throw new Error('Production NOWCAST_API_URL must use HTTPS.');
}

const pointLimit = Math.min(100, Math.max(1, Number(process.env.VERIFICATION_POINT_LIMIT ?? 50)));
const archive = new ForecastArchive(process.env.DATABASE_PATH ?? '.data/weathercast.sqlite');
const points = archive.listObservationPoints(pointLimit);
archive.close();

let issued = 0;
let failed = 0;
for (const point of points) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(new URL('/v1/nowcast', parsedEndpoint), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(point),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Nowcast API returned ${response.status}.`);
    issued += 1;
  } catch {
    failed += 1;
  } finally {
    clearTimeout(timeout);
  }
}

console.info(JSON.stringify({ points: points.length, issued, failed }));
if (failed > 0) process.exitCode = 1;
