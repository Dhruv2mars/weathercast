import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ForecastArchive } from '../archive';
import { coordinatesSchema } from '../contracts';
import { validateRadarDecoderOutput } from '../radar-nowcast-runner';

const coordinates = coordinatesSchema.parse({ latitude: process.argv[2], longitude: process.argv[3] });
const frameCount = Number(process.env.MRMS_NOWCAST_FRAME_COUNT ?? 4);
const members = Number(process.env.MRMS_NOWCAST_MEMBERS ?? 24);
if (!Number.isInteger(frameCount) || frameCount < 3 || frameCount > 12) {
  throw new Error('MRMS_NOWCAST_FRAME_COUNT must be an integer from 3 through 12.');
}
if (!Number.isInteger(members) || members < 12 || members > 96) {
  throw new Error('MRMS_NOWCAST_MEMBERS must be an integer from 12 through 96.');
}

const archive = new ForecastArchive(process.env.DATABASE_PATH ?? '.data/weathercast.sqlite');
const temporary = mkdtempSync(join(tmpdir(), 'weathercast-radar-run-'));
const projectRoot = join(import.meta.dir, '..', '..');

try {
  const newestFirst = archive.listRadarFrames('CONUS', 'PrecipRate_00.00', frameCount);
  if (newestFirst.length !== frameCount) throw new Error(`Expected ${frameCount} archived MRMS frames.`);
  const frames = newestFirst.reverse();
  const newestTime = new Date(frames.at(-1)!.observed_at).getTime();
  if (Date.now() - newestTime > 10 * 60_000) throw new Error('Newest MRMS frame is more than ten minutes old.');
  frames.slice(1).forEach((frame, index) => {
    const spacing = new Date(frame.observed_at).getTime() - new Date(frames[index].observed_at).getTime();
    if (spacing < 60_000 || spacing > 5 * 60_000) throw new Error('Archived MRMS frame spacing is invalid.');
  });

  const paths = frames.map((frame, index) => {
    const asset = archive.getSourceAsset(frame.source_asset_id);
    if (!asset || asset.media_type !== 'application/gzip') throw new Error('Archived MRMS source asset is unavailable.');
    const path = join(temporary, `frame-${index}.grib2.gz`);
    writeFileSync(path, asset.payload);
    return { path, sha256: asset.sha256 };
  });
  const python = process.env.RADAR_PYTHON ?? join(projectRoot, 'radar', '.venv', 'bin', 'python');
  const subprocess = Bun.spawn([
    python,
    join(projectRoot, 'radar', 'nowcast_grib.py'),
    ...paths.map((item) => item.path),
    '--latitude', String(coordinates.latitude),
    '--longitude', String(coordinates.longitude),
    '--members', String(members),
  ], { cwd: projectRoot, stdout: 'pipe', stderr: 'pipe' });
  const outputPromise = new Response(subprocess.stdout).text();
  const errorPromise = new Response(subprocess.stderr).text();
  const timeout = setTimeout(() => subprocess.kill(), 30_000);
  const exitCode = await subprocess.exited;
  clearTimeout(timeout);
  const [output, errorOutput] = await Promise.all([outputPromise, errorPromise]);
  if (exitCode !== 0) throw new Error(`Radar decoder failed: ${errorOutput.trim().slice(0, 500)}`);
  const nowcast = validateRadarDecoderOutput({
    output,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    sourceDataTime: frames.at(-1)!.observed_at,
    inputSha256: paths.map((item) => item.sha256),
  });
  const issuedAt = new Date().toISOString();
  const saved = archive.saveRadarNowcastRun({
    issuedAt,
    sourceDataTime: frames.at(-1)!.observed_at,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    domain: 'CONUS',
    product: 'PrecipRate_00.00',
    algorithmVersion: nowcast.algorithmVersion,
    inputFrameIds: frames.map((frame) => frame.id),
    response: nowcast,
  });
  console.info(JSON.stringify({
    id: saved.id,
    inserted: saved.inserted,
    issuedAt: saved.issuedAt,
    sourceDataTime: nowcast.sourceDataTime,
    intervals: nowcast.intervals.length,
  }));
} finally {
  rmSync(temporary, { recursive: true, force: true });
  archive.close();
}
