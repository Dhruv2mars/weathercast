import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ForecastArchive } from '../archive';
import { applyCalibrationArtifact } from '../calibration';
import { validateRadarBatchDecoderOutput } from '../radar-nowcast-runner';
import { getScheduledIssueTime, selectStudyRadarFrames } from '../study-issuance';

const studyId = process.argv[2];
if (!studyId) throw new Error('Usage: bun run api:issue-radar-study <study-id>');
const frameCount = Number(process.env.MRMS_NOWCAST_FRAME_COUNT ?? 4);
const members = Number(process.env.MRMS_NOWCAST_MEMBERS ?? 24);
if (!Number.isInteger(frameCount) || frameCount < 3 || frameCount > 12) {
  throw new Error('MRMS_NOWCAST_FRAME_COUNT must be an integer from 3 through 12.');
}
if (!Number.isInteger(members) || members < 12 || members > 96) {
  throw new Error('MRMS_NOWCAST_MEMBERS must be an integer from 12 through 96.');
}

const archive = new ForecastArchive(process.env.DATABASE_PATH ?? '.data/weathercast.sqlite');
const temporary = mkdtempSync(join(tmpdir(), 'weathercast-radar-study-'));
const projectRoot = join(import.meta.dir, '..', '..');

try {
  const study = archive.getVerificationStudy(studyId);
  if (!study) throw new Error('Verification study is not registered.');
  const startedAt = new Date();
  const scheduledAt = getScheduledIssueTime({
    now: startedAt,
    startsAt: study.starts_at,
    endsAt: study.ends_at,
    cadenceMinutes: study.issue_cadence_minutes,
  });
  const existing = archive.getVerificationStudyRadarIssue(studyId, scheduledAt);
  if (existing.length > 0) {
    if (existing.length !== study.targets.length) throw new Error('Archived study issue contains a partial cohort.');
    console.info(JSON.stringify({
      studyId,
      scheduledAt,
      inserted: false,
      runCount: existing.length,
      sourceDataTime: existing[0]!.source_data_time,
    }));
  } else {
    const frames = selectStudyRadarFrames({
      newestFirst: archive.listRadarFrames(study.domain, study.product, frameCount),
      expectedCount: frameCount,
      now: startedAt,
    });
    const paths = frames.map((frame, index) => {
      const asset = archive.getSourceAsset(frame.source_asset_id);
      if (!asset || asset.media_type !== 'application/gzip') {
        throw new Error('Archived MRMS source asset is unavailable.');
      }
      const path = join(temporary, `frame-${index}.grib2.gz`);
      writeFileSync(path, asset.payload);
      return { path, sha256: asset.sha256 };
    });
    const targetsPath = join(temporary, 'targets.json');
    writeFileSync(targetsPath, JSON.stringify(study.targets));
    const python = process.env.RADAR_PYTHON ?? join(projectRoot, 'radar', '.venv', 'bin', 'python');
    const subprocess = Bun.spawn([
      python,
      join(projectRoot, 'radar', 'batch_nowcast_grib.py'),
      ...paths.map((item) => item.path),
      '--targets', targetsPath,
      '--members', String(members),
    ], { cwd: projectRoot, stdout: 'pipe', stderr: 'pipe' });
    const outputPromise = new Response(subprocess.stdout).text();
    const errorPromise = new Response(subprocess.stderr).text();
    const timeout = setTimeout(() => subprocess.kill(), 60_000);
    const exitCode = await subprocess.exited;
    clearTimeout(timeout);
    const [output, errorOutput] = await Promise.all([outputPromise, errorPromise]);
    if (exitCode !== 0) throw new Error(`Radar batch decoder failed: ${errorOutput.trim().slice(0, 500)}`);
    const sourceDataTime = frames.at(-1)!.observed_at;
    const decoded = validateRadarBatchDecoderOutput({
      output,
      targets: study.targets,
      sourceDataTime,
      inputSha256: paths.map((item) => item.sha256),
    });
    const calibrationArtifact = archive.getEvaluationCalibrationArtifact(studyId);
    const issuedAt = new Date().toISOString();
    const saved = archive.saveVerificationStudyRadarBatch({
      studyId,
      scheduledAt,
      issuedAt,
      runs: decoded.map(({ targetId, nowcast }) => ({
        targetId,
        run: {
          sourceDataTime,
          latitude: nowcast.location.latitude,
          longitude: nowcast.location.longitude,
          domain: study.domain,
          product: study.product,
          algorithmVersion: nowcast.algorithmVersion,
          inputFrameIds: frames.map((frame) => frame.id),
          response: calibrationArtifact
            ? applyCalibrationArtifact(nowcast, calibrationArtifact)
            : nowcast,
        },
      })),
    });
    console.info(JSON.stringify({
      studyId,
      scheduledAt,
      issuedAt,
      inserted: true,
      runCount: saved.runs.length,
      sourceDataTime,
    }));
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
  archive.close();
}
