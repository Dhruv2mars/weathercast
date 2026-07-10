import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { ForecastArchive } from './archive';
import type { RadarNowcast } from './radar-nowcast-contract';
import { studyDefinitionSchema } from './study-contract';

function definition() {
  return studyDefinitionSchema.parse({
    id: 'mrms-metar-conus-2026q3-v1',
    title: 'Prospective CONUS MRMS rain occurrence study',
    startsAt: '2026-07-11T00:00:00.000Z',
    endsAt: '2026-10-01T00:00:00.000Z',
    algorithmVersion: 'translation-ensemble-v1',
    domain: 'CONUS',
    product: 'PrecipRate_00.00',
    stationIds: ['KHSV', 'KJFK'],
    issueCadenceMinutes: 15,
    horizonsMinutes: [0, 15, 30, 45, 60, 75, 90, 105],
    primaryMetric: 'brier_rain_occurrence_point',
    minimumObservationCountPerHorizon: 2_000,
    minimumIssuanceCompleteness: 0.95,
    observationSamplingPolicy: 'one nearest verified METAR observation per run and horizon; ties use earliest observation',
    validTimePolicy: 'observation must be at or after issuance and before study end',
    exclusionPolicy: 'verified prospective observations only; no post-registration cohort changes',
  });
}

function nowcast(target: { latitude: number; longitude: number }, sourceDataTime: string): RadarNowcast {
  return {
    schemaVersion: 1,
    algorithmVersion: 'translation-ensemble-v1',
    source: 'noaa-mrms-nodd',
    product: 'PrecipRate_00.00',
    sourceDataTime,
    horizonMinutes: 120,
    calibrationStatus: 'uncalibrated',
    motion: {
      status: 'estimated',
      rowPixelsPerMinute: 0,
      columnPixelsPerMinute: 0,
      spreadPixelsPerMinute: 0.1,
      signal: 0.8,
    },
    ensembleMembers: 24,
    seed: '0123456789abcdef',
    intervals: Array.from({ length: 8 }, (_, index) => ({
      leadStartMinutes: index * 15,
      leadEndMinutes: (index + 1) * 15,
      validAt: new Date(Date.parse(sourceDataTime) + (index * 15 + 7.5) * 60_000).toISOString(),
      status: 'valid' as const,
      probability: index === 0 ? 80 : 20,
      rainRateMmPerHour: 1,
    })),
    location: target,
    inputSha256: ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)],
    coverage: {
      tier: 'shadow',
      minimumTileFraction: 1,
      spatialResolutionKm: 1,
      reason: 'Uncalibrated shadow evaluation.',
    },
  };
}

describe('immutable prospective study registry', () => {
  test('freezes exact station coordinates and rejects definition changes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'weathercast-study-'));
    const path = join(directory, 'archive.sqlite');
    try {
      const archive = new ForecastArchive(path);
      for (const observation of [
        { id: 'KHSV', latitude: 34.6441, longitude: -86.7862 },
        { id: 'KJFK', latitude: 40.6392, longitude: -73.7639 },
      ]) {
        archive.saveObservation({
          source: 'aviation-weather-metar',
          sourceEventId: `${observation.id}:1`,
          observedAt: '2026-07-10T22:00:00.000Z',
          latitude: observation.latitude,
          longitude: observation.longitude,
          rainObserved: false,
          quality: 'verified',
          payload: { icaoId: observation.id },
        });
      }
      const targets = archive.listLatestMetarTargets().map(({ id, latitude, longitude }) => ({
        id,
        latitude,
        longitude,
      }));
      const first = archive.registerVerificationStudy({
        definition: definition(),
        registeredAt: '2026-07-10T23:00:00.000Z',
        targets,
      });
      expect(first.inserted).toBe(true);
      expect(archive.registerVerificationStudy({
        definition: definition(),
        registeredAt: '2026-07-10T23:30:00.000Z',
        targets,
      })).toEqual({ ...first, inserted: false });
      expect(archive.getVerificationStudy(first.id)).toEqual(expect.objectContaining({
        definition_sha256: first.definitionSha256,
        targets,
      }));
      expect(() => archive.registerVerificationStudy({
        definition: { ...definition(), minimumObservationCountPerHorizon: 3_000 },
        registeredAt: '2026-07-10T23:00:00.000Z',
        targets,
      })).toThrow('different definition');
      archive.close();

      const database = new Database(path);
      expect(() => database.query('DELETE FROM verification_study_targets WHERE study_id = ?').run(first.id))
        .toThrow('verification study targets are immutable');
      expect(() => database.query('UPDATE verification_studies SET ends_at = ? WHERE id = ?')
        .run('2027-01-01T00:00:00.000Z', first.id)).toThrow('verification studies are immutable');
      database.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('rejects registration at or after study start and incomplete cohorts', () => {
    const archive = new ForecastArchive(':memory:');
    const targets = [{ id: 'KHSV', latitude: 34.6441, longitude: -86.7862 }];
    expect(() => archive.registerVerificationStudy({
      definition: definition(),
      registeredAt: '2026-07-11T00:00:00.000Z',
      targets,
    })).toThrow('before they start');
    expect(() => archive.registerVerificationStudy({
      definition: definition(),
      registeredAt: '2026-07-10T23:00:00.000Z',
      targets,
    })).toThrow('exactly match');
    archive.close();
  });

  test('atomically links a complete radar batch to one scheduled study issue', () => {
    const directory = mkdtempSync(join(tmpdir(), 'weathercast-study-runs-'));
    const path = join(directory, 'archive.sqlite');
    try {
      const archive = new ForecastArchive(path);
      const targets = [
        { id: 'KHSV', latitude: 34.6441, longitude: -86.7862 },
        { id: 'KJFK', latitude: 40.6392, longitude: -73.7639 },
      ];
      archive.registerVerificationStudy({
        definition: definition(),
        registeredAt: '2026-07-10T23:00:00.000Z',
        targets,
      });
      const inputFrameIds = ['00:08', '00:10', '00:12'].map((minute, index) => {
        const observedAt = `2026-07-11T${minute}:00.000Z`;
        const asset = archive.saveSourceAsset({
          provider: 'noaa-mrms',
          upstreamKey: `frame-${index}`,
          retrievedAt: '2026-07-11T00:05:00.000Z',
          mediaType: 'application/gzip',
          bytes: new TextEncoder().encode(`frame-${index}`),
        });
        return archive.saveRadarFrame({
          domain: 'CONUS',
          product: 'PrecipRate_00.00',
          observedAt,
          retrievedAt: '2026-07-11T00:05:00.000Z',
          objectKey: `frame-${index}`,
          sourceAssetId: asset.id,
        });
      });
      const issuedAt = '2026-07-11T00:15:30.000Z';
      const scheduledAt = '2026-07-11T00:15:00.000Z';
      const runs = targets.map((target) => ({
        targetId: target.id,
        run: {
          sourceDataTime: '2026-07-11T00:12:00.000Z',
          latitude: target.latitude,
          longitude: target.longitude,
          domain: 'CONUS',
          product: 'PrecipRate_00.00',
          algorithmVersion: 'translation-ensemble-v1',
          inputFrameIds,
          response: nowcast(target, '2026-07-11T00:12:00.000Z'),
        },
      }));
      const first = archive.saveVerificationStudyRadarBatch({
        studyId: definition().id,
        scheduledAt,
        issuedAt,
        runs,
      });
      expect(first.runs.map((run) => run.linked)).toEqual([true, true]);
      expect(archive.saveVerificationStudyRadarBatch({
        studyId: definition().id,
        scheduledAt,
        issuedAt,
        runs,
      }).runs.map((run) => run.linked)).toEqual([false, false]);
      expect(archive.listVerificationStudyRadarRuns(definition().id)).toHaveLength(2);
      expect(() => archive.saveVerificationStudyRadarBatch({
        studyId: definition().id,
        scheduledAt: '2026-07-11T00:30:00.000Z',
        issuedAt: '2026-07-11T00:30:30.000Z',
        runs: [runs[0]!, {
          ...runs[1]!,
          run: { ...runs[1]!.run, inputFrameIds: inputFrameIds.slice(1) },
        }],
      })).toThrow('same ordered radar input frames');
      expect(() => archive.saveVerificationStudyRadarBatch({
        studyId: definition().id,
        scheduledAt: '2026-07-11T00:30:00.000Z',
        issuedAt: '2026-07-11T00:30:30.000Z',
        runs: runs.toReversed(),
      })).toThrow('complete target cohort');
      expect(archive.listVerificationStudyRadarRuns(definition().id)).toHaveLength(2);
      expect(() => archive.saveVerificationStudyRadarBatch({
        studyId: definition().id,
        scheduledAt: '2026-07-11T00:16:00.000Z',
        issuedAt: '2026-07-11T00:16:30.000Z',
        runs,
      })).toThrow('pre-registered schedule');
      expect(() => archive.saveVerificationStudyRadarBatch({
        studyId: definition().id,
        scheduledAt: '2026-07-11T00:15:00Z',
        issuedAt,
        runs,
      })).toThrow('pre-registered schedule');
      for (const [index, target] of targets.entries()) {
        archive.saveObservation({
          source: 'aviation-weather-metar',
          sourceEventId: `${target.id}:verified`,
          observedAt: '2026-07-11T00:20:00.000Z',
          latitude: target.latitude,
          longitude: target.longitude,
          rainObserved: index === 0,
          quality: 'verified',
          payload: { icaoId: target.id },
        });
      }
      archive.saveObservation({
        source: 'aviation-weather-metar',
        sourceEventId: 'KHSV:provisional',
        observedAt: '2026-07-11T00:19:00.000Z',
        latitude: targets[0]!.latitude,
        longitude: targets[0]!.longitude,
        rainObserved: false,
        quality: 'provisional',
        payload: { icaoId: 'KHSV' },
      });
      archive.saveObservation({
        source: 'unregistered-observation-source',
        sourceEventId: 'KHSV:other-source',
        observedAt: '2026-07-11T00:18:00.000Z',
        latitude: targets[0]!.latitude,
        longitude: targets[0]!.longitude,
        rainObserved: false,
        quality: 'verified',
        payload: { icaoId: 'KHSV' },
      });
      const report = archive.buildVerificationStudyReport(
        definition().id,
        new Date('2026-07-11T00:30:00.000Z'),
      );
      expect(report.horizons[0]).toEqual(expect.objectContaining({
        forecastCount: 2,
        observationCount: 2,
        missingObservationCount: 0,
      }));
      expect(report.horizons[1]!.observationCount).toBe(0);
      const savedReport = archive.saveVerificationStudyReport({
        studyId: definition().id,
        reportVersion: 'preliminary-v1',
        asOf: new Date('2026-07-11T00:30:00.000Z'),
      });
      expect(savedReport.inserted).toBe(true);
      expect(archive.saveVerificationStudyReport({
        studyId: definition().id,
        reportVersion: 'preliminary-v1',
        asOf: new Date('2026-07-11T00:30:00.000Z'),
      }).inserted).toBe(false);
      expect(() => archive.saveVerificationStudyReport({
        studyId: definition().id,
        reportVersion: 'preliminary-v1',
        asOf: new Date('2026-07-11T00:31:00.000Z'),
      })).toThrow('different evidence');
      archive.close();

      const database = new Database(path);
      expect(() => database.query('DELETE FROM verification_study_radar_runs').run())
        .toThrow('verification study radar run links are immutable');
      expect(() => database.query('DELETE FROM verification_study_reports').run())
        .toThrow('verification study reports are immutable');
      database.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
