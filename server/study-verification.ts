import { radarNowcastSchema } from './radar-nowcast-contract';
import type { StudyDefinition } from './study-contract';

export type StudyVerificationRun = {
  runId: string;
  targetId: string;
  scheduledAt: string;
  issuedAt: string;
  response: unknown;
};

export type StudyVerificationObservation = {
  id: string;
  targetId: string;
  observedAt: string;
  rainObserved: boolean;
};

type ReliabilityAccumulator = {
  count: number;
  probabilitySum: number;
  observedSum: number;
  brierSum: number;
};

type TimedObservation = StudyVerificationObservation & { timestamp: number };

const RELIABILITY_BIN_COUNT = 10;

function round(value: number) {
  return Number(value.toFixed(6));
}

function finishAccumulator(accumulator: ReliabilityAccumulator) {
  return {
    count: accumulator.count,
    meanForecastProbability: accumulator.count === 0
      ? null
      : round(accumulator.probabilitySum / accumulator.count),
    observedRainRate: accumulator.count === 0
      ? null
      : round(accumulator.observedSum / accumulator.count),
    brierScore: accumulator.count === 0
      ? null
      : round(accumulator.brierSum / accumulator.count),
  };
}

function lowerBound(observations: TimedObservation[], timestamp: number) {
  let lower = 0;
  let upper = observations.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (observations[middle]!.timestamp < timestamp) lower = middle + 1;
    else upper = middle;
  }
  return lower;
}

function findNearestObservation(
  observations: TimedObservation[],
  lowerTimestamp: number,
  upperTimestamp: number,
  midpoint: number,
) {
  const start = lowerBound(observations, lowerTimestamp);
  const end = lowerBound(observations, upperTimestamp);
  if (start >= end) return undefined;
  const clampedMidpoint = Math.min(Math.max(midpoint, lowerTimestamp), upperTimestamp);
  const rightIndex = lowerBound(observations, clampedMidpoint);
  const candidates: TimedObservation[] = [];
  if (rightIndex >= start && rightIndex < end) candidates.push(observations[rightIndex]!);
  const leftIndex = Math.min(rightIndex, end) - 1;
  if (leftIndex >= start) {
    const firstAtLeftTimestamp = lowerBound(observations, observations[leftIndex]!.timestamp);
    candidates.push(observations[Math.max(start, firstAtLeftTimestamp)]!);
  }
  return candidates.sort((left, right) => (
    Math.abs(left.timestamp - midpoint) - Math.abs(right.timestamp - midpoint)
    || left.timestamp - right.timestamp
    || left.id.localeCompare(right.id)
  ))[0];
}

/** Builds a deterministic, preregistration-bound report without mutating evidence. */
export function computeVerificationStudyReport(input: {
  definition: StudyDefinition;
  definitionSha256: string;
  registeredAt: string;
  targetIds: string[];
  runs: StudyVerificationRun[];
  observations: StudyVerificationObservation[];
  asOf: Date;
  reportPolicyPreregistered?: boolean;
}) {
  const asOf = input.asOf.getTime();
  const startsAt = new Date(input.definition.startsAt).getTime();
  const endsAt = new Date(input.definition.endsAt).getTime();
  if (!Number.isFinite(asOf)) throw new Error('Study report cutoff is invalid.');
  if (
    input.targetIds.length !== input.definition.stationIds.length
    || input.targetIds.some((targetId, index) => targetId !== input.definition.stationIds[index])
  ) throw new Error('Study report targets do not match the registered cohort.');
  const targetIds = new Set(input.targetIds);
  if (input.runs.some((run) => !targetIds.has(run.targetId))) {
    throw new Error('Study report contains a run outside the registered cohort.');
  }
  if (input.observations.some((observation) => !targetIds.has(observation.targetId))) {
    throw new Error('Study report contains an observation outside the registered cohort.');
  }

  const cadenceMs = input.definition.issueCadenceMinutes * 60_000;
  const completedCadenceBoundary = Math.floor(asOf / cadenceMs) * cadenceMs;
  const evaluationEnd = Math.min(Math.max(completedCadenceBoundary, startsAt), endsAt);
  const expectedIssueCount = Math.floor((evaluationEnd - startsAt) / cadenceMs);
  const expectedRunCount = expectedIssueCount * input.targetIds.length;
  const candidateRuns = input.runs.filter((run) => {
    const scheduledAt = new Date(run.scheduledAt).getTime();
    if (!Number.isFinite(scheduledAt)) throw new Error('Study run schedule time is invalid.');
    return scheduledAt >= startsAt && scheduledAt < evaluationEnd;
  });
  const runKeys = new Set<string>();
  const targetsBySchedule = new Map<string, Set<string>>();
  for (const run of candidateRuns) {
    const canonicalSchedule = new Date(run.scheduledAt).toISOString();
    const key = `${canonicalSchedule}:${run.targetId}`;
    if (runKeys.has(key)) throw new Error('Study report contains duplicate target runs for one schedule.');
    runKeys.add(key);
    const targets = targetsBySchedule.get(canonicalSchedule) ?? new Set<string>();
    targets.add(run.targetId);
    targetsBySchedule.set(canonicalSchedule, targets);
  }
  const completeSchedules = new Set(
    [...targetsBySchedule.entries()]
      .filter(([, targets]) => (
        targets.size === input.targetIds.length
        && input.targetIds.every((targetId) => targets.has(targetId))
      ))
      .map(([scheduledAt]) => scheduledAt),
  );
  const eligibleRuns = candidateRuns.filter((run) => completeSchedules.has(new Date(run.scheduledAt).toISOString()));
  const issuedIssueCount = completeSchedules.size;
  const issuanceCompleteness = expectedIssueCount === 0 ? null : round(issuedIssueCount / expectedIssueCount);
  const observationsByTarget = new Map<string, TimedObservation[]>();
  for (const observation of input.observations) {
    const observedAt = new Date(observation.observedAt).getTime();
    if (!Number.isFinite(observedAt)) throw new Error('Study observation time is invalid.');
    const observations = observationsByTarget.get(observation.targetId) ?? [];
    observations.push({ ...observation, timestamp: observedAt });
    observationsByTarget.set(observation.targetId, observations);
  }
  for (const observations of observationsByTarget.values()) {
    observations.sort((left, right) => (
      left.timestamp - right.timestamp
      || left.id.localeCompare(right.id)
    ));
  }

  const horizonAccumulators = new Map(input.definition.horizonsMinutes.map((horizonMinutes) => [
    horizonMinutes,
    {
      forecastCount: 0,
      aggregate: { count: 0, probabilitySum: 0, observedSum: 0, brierSum: 0 },
      bins: Array.from({ length: RELIABILITY_BIN_COUNT }, (): ReliabilityAccumulator => ({
        count: 0,
        probabilitySum: 0,
        observedSum: 0,
        brierSum: 0,
      })),
    },
  ]));

  for (const run of eligibleRuns) {
    const nowcast = radarNowcastSchema.parse(run.response);
    const issuedAt = new Date(run.issuedAt).getTime();
    const sourceDataTime = new Date(nowcast.sourceDataTime).getTime();
    if (!Number.isFinite(issuedAt) || !Number.isFinite(sourceDataTime)) {
      throw new Error('Study run time is invalid.');
    }
    for (const horizonMinutes of input.definition.horizonsMinutes) {
      const interval = nowcast.intervals.find((candidate) => candidate.leadStartMinutes === horizonMinutes);
      if (!interval || interval.status !== 'valid' || interval.probability === null) continue;
      const intervalStart = sourceDataTime + interval.leadStartMinutes * 60_000;
      const intervalEnd = sourceDataTime + interval.leadEndMinutes * 60_000;
      const lowerBound = Math.max(intervalStart, issuedAt, startsAt);
      const upperBound = Math.min(intervalEnd, evaluationEnd, endsAt);
      if (lowerBound >= upperBound) continue;
      const accumulator = horizonAccumulators.get(horizonMinutes)!;
      accumulator.forecastCount += 1;
      const midpoint = (intervalStart + intervalEnd) / 2;
      const observation = findNearestObservation(
        observationsByTarget.get(run.targetId) ?? [],
        lowerBound,
        upperBound,
        midpoint,
      );
      if (!observation) continue;
      const probability = interval.probability / 100;
      const observed = observation.rainObserved ? 1 : 0;
      const brier = (probability - observed) ** 2;
      const binIndex = Math.min(RELIABILITY_BIN_COUNT - 1, Math.floor(interval.probability / 10));
      for (const target of [accumulator.aggregate, accumulator.bins[binIndex]!]) {
        target.count += 1;
        target.probabilitySum += probability;
        target.observedSum += observed;
        target.brierSum += brier;
      }
    }
  }

  const horizons = input.definition.horizonsMinutes.map((horizonMinutes) => {
    const accumulator = horizonAccumulators.get(horizonMinutes)!;
    return {
      horizonMinutes,
      forecastCount: accumulator.forecastCount,
      observationCount: accumulator.aggregate.count,
      missingObservationCount: accumulator.forecastCount - accumulator.aggregate.count,
      ...finishAccumulator(accumulator.aggregate),
      reliabilityBins: accumulator.bins.map((bin, index) => ({
        lowerProbabilityInclusive: index / RELIABILITY_BIN_COUNT,
        upperProbabilityExclusive: index === RELIABILITY_BIN_COUNT - 1
          ? null
          : (index + 1) / RELIABILITY_BIN_COUNT,
        includesProbabilityOne: index === RELIABILITY_BIN_COUNT - 1,
        ...finishAccumulator(bin),
      })),
    };
  });
  const gateFailures: string[] = [];
  if (input.reportPolicyPreregistered === false) gateFailures.push('report_policy_not_preregistered');
  if (asOf < endsAt) gateFailures.push('study_in_progress');
  if (issuanceCompleteness === null || issuanceCompleteness < input.definition.minimumIssuanceCompleteness) {
    gateFailures.push('issuance_completeness_below_threshold');
  }
  for (const horizon of horizons) {
    if (horizon.observationCount < input.definition.minimumObservationCountPerHorizon) {
      gateFailures.push(`sample_gate_not_met:${horizon.horizonMinutes}`);
    }
  }

  return {
    schemaVersion: 1 as const,
    studyId: input.definition.id,
    studyTitle: input.definition.title,
    definitionSha256: input.definitionSha256,
    registeredAt: input.registeredAt,
    algorithmVersion: input.definition.algorithmVersion,
    domain: input.definition.domain,
    product: input.definition.product,
    targetIds: input.targetIds,
    generatedAt: input.asOf.toISOString(),
    evaluationStartsAt: input.definition.startsAt,
    evaluationEndsAt: new Date(evaluationEnd).toISOString(),
    finalStudyEndsAt: input.definition.endsAt,
    expectedIssueCount,
    expectedRunCount,
    archivedRunCount: candidateRuns.length,
    issuedIssueCount,
    issuedRunCount: eligibleRuns.length,
    partialIssueCount: targetsBySchedule.size - issuedIssueCount,
    issuanceCompleteness,
    minimumIssuanceCompleteness: input.definition.minimumIssuanceCompleteness,
    minimumObservationCountPerHorizon: input.definition.minimumObservationCountPerHorizon,
    observationSamplingPolicy: input.definition.observationSamplingPolicy,
    validTimePolicy: input.definition.validTimePolicy,
    reportPolicyPreregistered: input.reportPolicyPreregistered ?? true,
    primaryMetric: input.definition.primaryMetric,
    claimScope: 'own-model point rain-occurrence skill only; no competitor superiority claim' as const,
    eligibleForPublication: gateFailures.length === 0,
    gateFailures,
    eligibleForPrecisionPromotion: false as const,
    precisionPromotionGateFailures: [
      'algorithm_is_uncalibrated_shadow_baseline',
      'independent_calibration_holdout_not_registered',
    ] as const,
    horizons,
  };
}
