import { createHash } from 'node:crypto';

import { radarNowcastSchema, type RadarNowcast } from './radar-nowcast-contract';

export type CalibrationSample = {
  partition: 'training' | 'validation';
  studyId: string;
  runId: string;
  targetId: string;
  horizonMinutes: number;
  probability: number;
  observedRain: boolean;
  observedAt: string;
};

export type IsotonicBlock = {
  lowerProbabilityInclusive: number;
  upperProbabilityInclusive: number;
  sampleCount: number;
  observedRainCount: number;
  calibratedProbability: number;
};

export type CalibrationArtifact = {
  schemaVersion: 1;
  id: string;
  sha256: string;
  planId: string;
  planSha256: string;
  artifactVersion: string;
  fittedAt: string;
  method: 'isotonic-pav-v1';
  algorithmVersion: 'translation-ensemble-v1';
  domain: 'CONUS';
  product: 'PrecipRate_00.00';
  evaluationStudyId: string;
  evaluationStudySha256: string;
  inputSampleSha256: string;
  trainingSampleCount: number;
  validationSampleCount: number;
  minimumSamplesPerHorizon: number;
  maximumValidationBrierDegradation: number;
  minimumAggregateValidationBrierImprovement: number;
  eligibleForShadowApplication: boolean;
  gateFailures: string[];
  rawValidationBrierScore: number | null;
  calibratedValidationBrierScore: number | null;
  horizons: Array<{
    horizonMinutes: number;
    trainingSampleCount: number;
    validationSampleCount: number;
    rawValidationBrierScore: number | null;
    calibratedValidationBrierScore: number | null;
    blocks: IsotonicBlock[];
  }>;
};

type MutableIsotonicBlock = {
  lowerProbabilityInclusive: number;
  upperProbabilityInclusive: number;
  sampleCount: number;
  observedRainCount: number;
};

function round(value: number) {
  return Number(value.toFixed(6));
}

function isCanonicalIsoTimestamp(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function assertHash(value: string, field: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${field} must be a lowercase SHA-256 digest.`);
}

function stableSamples(samples: CalibrationSample[]) {
  return samples.toSorted((left, right) => (
    left.partition.localeCompare(right.partition)
    || left.studyId.localeCompare(right.studyId)
    || left.runId.localeCompare(right.runId)
    || left.targetId.localeCompare(right.targetId)
    || left.horizonMinutes - right.horizonMinutes
    || left.observedAt.localeCompare(right.observedAt)
    || left.probability - right.probability
    || Number(left.observedRain) - Number(right.observedRain)
  ));
}

function fitBlocks(samples: CalibrationSample[]): IsotonicBlock[] {
  const grouped = new Map<number, MutableIsotonicBlock>();
  for (const sample of samples) {
    const block = grouped.get(sample.probability) ?? {
      lowerProbabilityInclusive: sample.probability,
      upperProbabilityInclusive: sample.probability,
      sampleCount: 0,
      observedRainCount: 0,
    };
    block.sampleCount += 1;
    block.observedRainCount += sample.observedRain ? 1 : 0;
    grouped.set(sample.probability, block);
  }
  const blocks = [...grouped.values()].sort(
    (left, right) => left.lowerProbabilityInclusive - right.lowerProbabilityInclusive,
  );
  for (let index = 0; index < blocks.length - 1;) {
    const left = blocks[index]!;
    const right = blocks[index + 1]!;
    if (left.observedRainCount / left.sampleCount <= right.observedRainCount / right.sampleCount) {
      index += 1;
      continue;
    }
    blocks.splice(index, 2, {
      lowerProbabilityInclusive: left.lowerProbabilityInclusive,
      upperProbabilityInclusive: right.upperProbabilityInclusive,
      sampleCount: left.sampleCount + right.sampleCount,
      observedRainCount: left.observedRainCount + right.observedRainCount,
    });
    if (index > 0) index -= 1;
  }
  return blocks.map((block) => ({
    ...block,
    calibratedProbability: Math.round(100 * block.observedRainCount / block.sampleCount),
  }));
}

function calibratedProbability(probability: number, blocks: IsotonicBlock[]) {
  if (blocks.length === 0) throw new Error('Calibration model contains no isotonic blocks.');
  return (blocks.find((block) => probability <= block.upperProbabilityInclusive) ?? blocks.at(-1)!)
    .calibratedProbability;
}

function brierScoreExact(samples: CalibrationSample[], blocks?: IsotonicBlock[]) {
  if (samples.length === 0) return null;
  const total = samples.reduce((sum, sample) => {
    const probability = blocks
      ? calibratedProbability(sample.probability, blocks) / 100
      : sample.probability / 100;
    return sum + (probability - Number(sample.observedRain)) ** 2;
  }, 0);
  return total / samples.length;
}

function artifactPayload(artifact: Omit<CalibrationArtifact, 'id' | 'sha256'>) {
  return JSON.stringify(artifact);
}

export function verifyCalibrationArtifact(artifact: CalibrationArtifact) {
  const { id, sha256, ...payload } = artifact;
  const computedSha256 = createHash('sha256').update(artifactPayload(payload)).digest('hex');
  if (computedSha256 !== sha256 || id !== computedSha256.slice(0, 24)) {
    throw new Error('Calibration artifact checksum is invalid.');
  }
  return artifact;
}

export function fitIsotonicCalibrationArtifact(input: {
  planId: string;
  planSha256: string;
  artifactVersion: string;
  fittedAt: string;
  algorithmVersion: 'translation-ensemble-v1';
  domain: 'CONUS';
  product: 'PrecipRate_00.00';
  evaluationStudyId: string;
  evaluationStudySha256: string;
  horizonsMinutes: number[];
  minimumSamplesPerHorizon: number;
  maximumValidationBrierDegradation: number;
  minimumAggregateValidationBrierImprovement: number;
  samples: CalibrationSample[];
}): CalibrationArtifact {
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(input.artifactVersion)) {
    throw new Error('Calibration artifact version is invalid.');
  }
  if (!isCanonicalIsoTimestamp(input.fittedAt)) throw new Error('Calibration fit time must be canonical UTC ISO.');
  assertHash(input.planSha256, 'Calibration plan checksum');
  assertHash(input.evaluationStudySha256, 'Evaluation study checksum');
  if (
    input.horizonsMinutes.length === 0
    || new Set(input.horizonsMinutes).size !== input.horizonsMinutes.length
    || !input.horizonsMinutes.every((horizon, index) => (
      Number.isInteger(horizon)
      && horizon >= 0
      && horizon <= 105
      && horizon % 15 === 0
      && (index === 0 || horizon > input.horizonsMinutes[index - 1]!)
    ))
  ) throw new Error('Calibration horizons must be unique, sorted 15-minute leads.');
  if (!Number.isInteger(input.minimumSamplesPerHorizon) || input.minimumSamplesPerHorizon < 10) {
    throw new Error('Calibration requires at least ten samples per horizon and partition.');
  }
  if (
    !Number.isFinite(input.maximumValidationBrierDegradation)
    || input.maximumValidationBrierDegradation < 0
    || input.maximumValidationBrierDegradation > 0.1
    || !Number.isFinite(input.minimumAggregateValidationBrierImprovement)
    || input.minimumAggregateValidationBrierImprovement < 0
    || input.minimumAggregateValidationBrierImprovement > 0.1
  ) throw new Error('Calibration validation gates are invalid.');

  const samples = stableSamples(input.samples);
  const identities = new Set<string>();
  for (const sample of samples) {
    if (
      !input.horizonsMinutes.includes(sample.horizonMinutes)
      || !Number.isInteger(sample.probability)
      || sample.probability < 0
      || sample.probability > 100
      || !isCanonicalIsoTimestamp(sample.observedAt)
    ) throw new Error('Calibration sample is invalid or outside the registered horizons.');
    const identity = `${sample.partition}:${sample.studyId}:${sample.runId}:${sample.targetId}:${sample.horizonMinutes}`;
    if (identities.has(identity)) throw new Error('Calibration samples contain a duplicate forecast identity.');
    identities.add(identity);
  }
  const gateFailures: string[] = [];
  const horizons = input.horizonsMinutes.map((horizonMinutes) => {
    const training = samples.filter(
      (sample) => sample.partition === 'training' && sample.horizonMinutes === horizonMinutes,
    );
    const validation = samples.filter(
      (sample) => sample.partition === 'validation' && sample.horizonMinutes === horizonMinutes,
    );
    const blocks = fitBlocks(training);
    const rawValidationBrierExact = brierScoreExact(validation);
    const calibratedValidationBrierExact = blocks.length === 0
      ? null
      : brierScoreExact(validation, blocks);
    const rawValidationBrierScore = rawValidationBrierExact === null
      ? null
      : round(rawValidationBrierExact);
    const calibratedValidationBrierScore = calibratedValidationBrierExact === null
      ? null
      : round(calibratedValidationBrierExact);
    if (training.length < input.minimumSamplesPerHorizon) {
      gateFailures.push(`training_sample_gate_not_met:${horizonMinutes}`);
    }
    if (validation.length < input.minimumSamplesPerHorizon) {
      gateFailures.push(`validation_sample_gate_not_met:${horizonMinutes}`);
    }
    if (
      rawValidationBrierExact !== null
      && calibratedValidationBrierExact !== null
      && calibratedValidationBrierExact - rawValidationBrierExact
        > input.maximumValidationBrierDegradation + Number.EPSILON
    ) gateFailures.push(`validation_brier_degraded:${horizonMinutes}`);
    return {
      horizonMinutes,
      trainingSampleCount: training.length,
      validationSampleCount: validation.length,
      rawValidationBrierScore,
      calibratedValidationBrierScore,
      blocks,
    };
  });
  const validation = samples.filter((sample) => sample.partition === 'validation');
  const rawValidationBrierExact = brierScoreExact(validation);
  const rawValidationBrierScore = rawValidationBrierExact === null
    ? null
    : round(rawValidationBrierExact);
  const horizonByLead = new Map(horizons.map((horizon) => [horizon.horizonMinutes, horizon]));
  const calibratedValidationTotal = validation.reduce((sum, sample) => {
    const blocks = horizonByLead.get(sample.horizonMinutes)!.blocks;
    if (blocks.length === 0) return sum;
    const probability = calibratedProbability(sample.probability, blocks) / 100;
    return sum + (probability - Number(sample.observedRain)) ** 2;
  }, 0);
  const calibratedValidationBrierExact = validation.length === 0
    || horizons.some((horizon) => horizon.blocks.length === 0)
    ? null
    : calibratedValidationTotal / validation.length;
  const calibratedValidationBrierScore = calibratedValidationBrierExact === null
    ? null
    : round(calibratedValidationBrierExact);
  if (
    rawValidationBrierExact === null
    || calibratedValidationBrierExact === null
    || rawValidationBrierExact - calibratedValidationBrierExact + Number.EPSILON
      < input.minimumAggregateValidationBrierImprovement
  ) gateFailures.push('aggregate_validation_brier_improvement_below_threshold');

  const inputSampleSha256 = createHash('sha256').update(JSON.stringify(samples)).digest('hex');
  const payload: Omit<CalibrationArtifact, 'id' | 'sha256'> = {
    schemaVersion: 1,
    planId: input.planId,
    planSha256: input.planSha256,
    artifactVersion: input.artifactVersion,
    fittedAt: input.fittedAt,
    method: 'isotonic-pav-v1',
    algorithmVersion: input.algorithmVersion,
    domain: input.domain,
    product: input.product,
    evaluationStudyId: input.evaluationStudyId,
    evaluationStudySha256: input.evaluationStudySha256,
    inputSampleSha256,
    trainingSampleCount: samples.filter((sample) => sample.partition === 'training').length,
    validationSampleCount: validation.length,
    minimumSamplesPerHorizon: input.minimumSamplesPerHorizon,
    maximumValidationBrierDegradation: input.maximumValidationBrierDegradation,
    minimumAggregateValidationBrierImprovement: input.minimumAggregateValidationBrierImprovement,
    eligibleForShadowApplication: gateFailures.length === 0,
    gateFailures,
    rawValidationBrierScore,
    calibratedValidationBrierScore,
    horizons,
  };
  const sha256 = createHash('sha256').update(artifactPayload(payload)).digest('hex');
  return { ...payload, id: sha256.slice(0, 24), sha256 };
}

export function applyCalibrationArtifact(nowcastInput: RadarNowcast, artifactInput: CalibrationArtifact) {
  const nowcast = radarNowcastSchema.parse(nowcastInput);
  const artifact = verifyCalibrationArtifact(artifactInput);
  if (!artifact.eligibleForShadowApplication) throw new Error('Calibration artifact did not pass validation gates.');
  if (nowcast.calibrationStatus !== 'uncalibrated' || nowcast.calibration) {
    throw new Error('A radar nowcast cannot be calibrated more than once.');
  }
  if (
    nowcast.algorithmVersion !== artifact.algorithmVersion
    || nowcast.product !== artifact.product
  ) throw new Error('Calibration artifact provenance does not match the radar nowcast.');
  const horizonByLead = new Map(artifact.horizons.map((horizon) => [horizon.horizonMinutes, horizon]));
  if (nowcast.intervals.some((interval) => interval.status === 'valid' && !horizonByLead.has(interval.leadStartMinutes))) {
    throw new Error('Calibration artifact must cover every valid radar interval.');
  }
  const calibrated = {
    ...nowcast,
    calibrationStatus: 'provisional' as const,
    calibration: {
      artifactId: artifact.id,
      artifactSha256: artifact.sha256,
      method: artifact.method,
      rawProbabilities: nowcast.intervals.map((interval) => interval.probability),
    },
    intervals: nowcast.intervals.map((interval) => {
      const horizon = horizonByLead.get(interval.leadStartMinutes);
      if (interval.status !== 'valid' || !horizon) return interval;
      return { ...interval, probability: calibratedProbability(interval.probability, horizon.blocks) };
    }),
    coverage: {
      ...nowcast.coverage,
      reason: 'Validation-gated calibration active; independent prospective holdout pending.',
    },
  };
  return radarNowcastSchema.parse(calibrated);
}
