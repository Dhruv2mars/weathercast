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

export type StudyVerificationPair = {
  studyId: string;
  runId: string;
  targetId: string;
  horizonMinutes: number;
  probability: number;
  observedRain: boolean;
  observedAt: string;
  rawCounterfactualProbability?: number;
  calibrationArtifactId?: string;
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
export function computeVerificationStudyEvidence(input: {
  definition: StudyDefinition;
  definitionSha256: string;
  registeredAt: string;
  targetIds: string[];
  runs: StudyVerificationRun[];
  observations: StudyVerificationObservation[];
  asOf: Date;
  reportPolicyPreregistered?: boolean;
  calibrationEvaluationPolicy?: {
    artifactId: string;
    artifactSha256: string;
    maximumHoldoutBrierDegradation: number;
    minimumAggregateHoldoutBrierImprovement: number;
  };
}) {
  const asOf = input.asOf.getTime();
  const startsAt = new Date(input.definition.startsAt).getTime();
  const endsAt = new Date(input.definition.endsAt).getTime();
  if (!Number.isFinite(asOf)) throw new Error('Study report cutoff is invalid.');
  if (input.calibrationEvaluationPolicy && (
    !/^[a-f0-9]{24}$/.test(input.calibrationEvaluationPolicy.artifactId)
    || !/^[a-f0-9]{64}$/.test(input.calibrationEvaluationPolicy.artifactSha256)
    || !Number.isFinite(input.calibrationEvaluationPolicy.maximumHoldoutBrierDegradation)
    || input.calibrationEvaluationPolicy.maximumHoldoutBrierDegradation < 0
    || input.calibrationEvaluationPolicy.maximumHoldoutBrierDegradation > 0.1
    || !Number.isFinite(input.calibrationEvaluationPolicy.minimumAggregateHoldoutBrierImprovement)
    || input.calibrationEvaluationPolicy.minimumAggregateHoldoutBrierImprovement < 0
    || input.calibrationEvaluationPolicy.minimumAggregateHoldoutBrierImprovement > 0.1
  )) throw new Error('Calibration holdout policy is invalid.');
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
      rawCounterfactual: { count: 0, probabilitySum: 0, observedSum: 0, brierSum: 0 },
      bins: Array.from({ length: RELIABILITY_BIN_COUNT }, (): ReliabilityAccumulator => ({
        count: 0,
        probabilitySum: 0,
        observedSum: 0,
        brierSum: 0,
      })),
    },
  ]));
  const pairs: StudyVerificationPair[] = [];
  const calibrationArtifactIds = new Set<string>();
  const calibrationArtifactSha256s = new Set<string>();
  let provisionalRunCount = 0;
  let uncalibratedRunCount = 0;

  for (const run of eligibleRuns) {
    const nowcast = radarNowcastSchema.parse(run.response);
    if (nowcast.calibrationStatus === 'provisional') {
      provisionalRunCount += 1;
      calibrationArtifactIds.add(nowcast.calibration!.artifactId);
      calibrationArtifactSha256s.add(nowcast.calibration!.artifactSha256);
    } else {
      uncalibratedRunCount += 1;
    }
    const issuedAt = new Date(run.issuedAt).getTime();
    const sourceDataTime = new Date(nowcast.sourceDataTime).getTime();
    if (!Number.isFinite(issuedAt) || !Number.isFinite(sourceDataTime)) {
      throw new Error('Study run time is invalid.');
    }
    for (const horizonMinutes of input.definition.horizonsMinutes) {
      const intervalIndex = nowcast.intervals.findIndex(
        (candidate) => candidate.leadStartMinutes === horizonMinutes,
      );
      const interval = nowcast.intervals[intervalIndex];
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
      const rawCounterfactualProbability = nowcast.calibration?.rawProbabilities[intervalIndex];
      pairs.push({
        studyId: input.definition.id,
        runId: run.runId,
        targetId: run.targetId,
        horizonMinutes,
        probability: interval.probability,
        observedRain: observation.rainObserved,
        observedAt: observation.observedAt,
        ...(rawCounterfactualProbability !== undefined && rawCounterfactualProbability !== null
          ? { rawCounterfactualProbability, calibrationArtifactId: nowcast.calibration!.artifactId }
          : {}),
      });
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
      if (rawCounterfactualProbability !== undefined && rawCounterfactualProbability !== null) {
        const rawProbability = rawCounterfactualProbability / 100;
        accumulator.rawCounterfactual.count += 1;
        accumulator.rawCounterfactual.probabilitySum += rawProbability;
        accumulator.rawCounterfactual.observedSum += observed;
        accumulator.rawCounterfactual.brierSum += (rawProbability - observed) ** 2;
      }
    }
  }

  const horizons = input.definition.horizonsMinutes.map((horizonMinutes) => {
    const accumulator = horizonAccumulators.get(horizonMinutes)!;
    const rawCounterfactual = finishAccumulator(accumulator.rawCounterfactual);
    return {
      horizonMinutes,
      forecastCount: accumulator.forecastCount,
      observationCount: accumulator.aggregate.count,
      missingObservationCount: accumulator.forecastCount - accumulator.aggregate.count,
      ...finishAccumulator(accumulator.aggregate),
      uncalibratedCounterfactualCount: rawCounterfactual.count,
      uncalibratedCounterfactualBrierScore: rawCounterfactual.brierScore,
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
  const calibrationEvidenceStatus = provisionalRunCount === 0
    ? 'uncalibrated_baseline' as const
    : uncalibratedRunCount === 0
      && calibrationArtifactIds.size === 1
      && calibrationArtifactSha256s.size === 1
      ? 'provisional_holdout' as const
      : 'mixed_or_inconsistent' as const;
  const precisionPromotionGateFailures: string[] = [];
  let calibrationHoldout: {
    observationCount: number;
    rawBrierScore: number;
    calibratedBrierScore: number;
    brierImprovement: number;
  } | null = null;
  if (calibrationEvidenceStatus === 'uncalibrated_baseline') {
    if (input.calibrationEvaluationPolicy) {
      precisionPromotionGateFailures.push('independent_calibration_holdout_has_no_provisional_runs');
    } else {
      precisionPromotionGateFailures.push(
        'algorithm_is_uncalibrated_shadow_baseline',
        'independent_calibration_holdout_not_registered',
      );
    }
  } else if (calibrationEvidenceStatus === 'mixed_or_inconsistent') {
    precisionPromotionGateFailures.push('calibration_provenance_is_mixed_or_inconsistent');
  } else {
    const policy = input.calibrationEvaluationPolicy;
    if (!policy) {
      precisionPromotionGateFailures.push('calibration_evaluation_policy_not_preregistered');
    } else if (
      !calibrationArtifactIds.has(policy.artifactId)
      || !calibrationArtifactSha256s.has(policy.artifactSha256)
    ) {
      precisionPromotionGateFailures.push('calibration_artifact_does_not_match_preregistered_holdout');
    }
    if (gateFailures.length > 0) {
      precisionPromotionGateFailures.push('publication_evidence_gates_not_met');
    }
    let counterfactualComplete = true;
    for (const horizon of horizons) {
      if (horizon.uncalibratedCounterfactualCount !== horizon.observationCount) {
        counterfactualComplete = false;
        precisionPromotionGateFailures.push(`raw_counterfactual_missing:${horizon.horizonMinutes}`);
      } else if (
        policy
      ) {
        const horizonPairs = pairs.filter((pair) => pair.horizonMinutes === horizon.horizonMinutes);
        const calibratedTotal = horizonPairs.reduce((sum, pair) => (
          sum + (pair.probability / 100 - Number(pair.observedRain)) ** 2
        ), 0);
        const rawTotal = horizonPairs.reduce((sum, pair) => (
          sum + (pair.rawCounterfactualProbability! / 100 - Number(pair.observedRain)) ** 2
        ), 0);
        if (
          calibratedTotal - rawTotal
          > policy.maximumHoldoutBrierDegradation * horizonPairs.length + Number.EPSILON
        ) precisionPromotionGateFailures.push(`holdout_brier_degraded:${horizon.horizonMinutes}`);
      }
    }
    const paired = pairs.filter((pair) => pair.rawCounterfactualProbability !== undefined);
    if (counterfactualComplete && paired.length > 0) {
      const rawBrierExact = paired.reduce((sum, pair) => (
        sum + (pair.rawCounterfactualProbability! / 100 - Number(pair.observedRain)) ** 2
      ), 0) / paired.length;
      const calibratedBrierExact = paired.reduce((sum, pair) => (
        sum + (pair.probability / 100 - Number(pair.observedRain)) ** 2
      ), 0) / paired.length;
      const rawBrierScore = round(rawBrierExact);
      const calibratedBrierScore = round(calibratedBrierExact);
      const brierImprovement = round(rawBrierExact - calibratedBrierExact);
      calibrationHoldout = {
        observationCount: paired.length,
        rawBrierScore,
        calibratedBrierScore,
        brierImprovement,
      };
      if (
        policy
        && rawBrierExact - calibratedBrierExact + Number.EPSILON
          < policy.minimumAggregateHoldoutBrierImprovement
      ) {
        precisionPromotionGateFailures.push('aggregate_holdout_brier_improvement_below_threshold');
      }
    } else if (counterfactualComplete) {
      precisionPromotionGateFailures.push('calibration_holdout_has_no_paired_observations');
    }
  }

  const report = {
    schemaVersion: 2 as const,
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
    calibrationEvidence: {
      status: calibrationEvidenceStatus,
      artifactIds: [...calibrationArtifactIds].sort(),
      provisionalRunCount,
      uncalibratedRunCount,
    },
    calibrationHoldout,
    claimScope: 'own-model point rain-occurrence skill only; no competitor superiority claim' as const,
    eligibleForPublication: gateFailures.length === 0,
    gateFailures,
    eligibleForPrecisionPromotion: precisionPromotionGateFailures.length === 0,
    precisionPromotionScope:
      'calibration evidence gate only; production rights and operations remain separate release gates' as const,
    precisionPromotionGateFailures,
    horizons,
  };
  return { report, pairs };
}

export function computeVerificationStudyReport(input: Parameters<typeof computeVerificationStudyEvidence>[0]) {
  return computeVerificationStudyEvidence(input).report;
}
