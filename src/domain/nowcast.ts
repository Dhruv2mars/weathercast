import type {
  ConfidenceLabel,
  ForecastInterval,
  NormalizedForecast,
  Nowcast,
  RainIntensity,
} from '@/types/weather';

const WET_THRESHOLD_MM = 0.05;
const HORIZON_MINUTES = 120;
const SLOT_MINUTES = 15;

export function intensityForAmount(amountMm: number): RainIntensity {
  if (amountMm < WET_THRESHOLD_MM) return 'none';
  if (amountMm < 0.15) return 'trace';
  if (amountMm < 0.5) return 'light';
  if (amountMm < 2) return 'moderate';
  if (amountMm < 5) return 'heavy';
  return 'extreme';
}

function minutesBetween(start: Date, end: Date) {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
}

function confidenceFor(intervals: ForecastInterval[], wetIndexes: number[]) {
  const relevant = wetIndexes.length > 0 ? wetIndexes.map((index) => intervals[index]) : intervals;
  const avgProbability = relevant.reduce((sum, interval) => sum + interval.probability, 0) / Math.max(1, relevant.length);
  const agreement = relevant.reduce((sum, interval) => {
    const wet = interval.precipitationMm >= WET_THRESHOLD_MM;
    const likely = interval.probability >= 50;
    return sum + (wet === likely ? 1 : 0);
  }, 0) / Math.max(1, relevant.length);
  const score = Math.round(Math.min(95, Math.max(25, 35 + avgProbability * 0.35 + agreement * 30)));
  const label: ConfidenceLabel = score >= 75 ? 'high' : score >= 50 ? 'medium' : 'low';
  const explanation = label === 'high'
    ? 'The available guidance agrees on this outcome.'
    : label === 'medium'
      ? 'Timing may shift as the next update arrives.'
      : 'Signals disagree, so treat the timing as uncertain.';
  return { score, label, explanation };
}

function durationLabel(minutes: number) {
  if (minutes >= 120) return 'at least 2 hours';
  if (minutes >= 60) return `about ${Math.round(minutes / 15) * 15} minutes`;
  return `about ${Math.max(15, Math.round(minutes / 5) * 5)} minutes`;
}

export function buildNowcast(forecast: NormalizedForecast, now = new Date()): Nowcast {
  const intervals = forecast.intervals
    .filter((interval) => new Date(interval.time).getTime() >= now.getTime() - SLOT_MINUTES * 60_000)
    .slice(0, HORIZON_MINUTES / SLOT_MINUTES);
  const firstIntervalTime = intervals[0] ? new Date(intervals[0].time).getTime() : Number.NaN;
  if (intervals.length < HORIZON_MINUTES / SLOT_MINUTES
      || !Number.isFinite(firstIntervalTime)
      || firstIntervalTime - now.getTime() > SLOT_MINUTES * 2 * 60_000) {
    throw new Error('FORECAST_HORIZON_UNAVAILABLE');
  }
  const firstWetIndex = intervals.findIndex((interval) => interval.precipitationMm >= WET_THRESHOLD_MM);

  if (firstWetIndex < 0) {
    return {
      issuedAt: forecast.issuedAt,
      status: 'clear',
      headline: 'No rain expected for 2 hours',
      detail: 'No rain signal detected near this location.',
      clearMinutes: HORIZON_MINUTES,
      intervals,
      confidence: confidenceFor(intervals, []),
      dataTier: 'standard',
      source: forecast.source,
      event: null,
    };
  }

  const wetIndexes: number[] = [firstWetIndex];
  let lastWetIndex = firstWetIndex;
  let dryRun = 0;
  for (let index = firstWetIndex + 1; index < intervals.length; index += 1) {
    if (intervals[index].precipitationMm >= WET_THRESHOLD_MM) {
      wetIndexes.push(index);
      lastWetIndex = index;
      dryRun = 0;
    } else {
      dryRun += 1;
      if (dryRun >= 2) break;
    }
  }

  const start = new Date(intervals[firstWetIndex].time);
  const end = new Date(new Date(intervals[lastWetIndex].time).getTime() + SLOT_MINUTES * 60_000);
  const minutesUntil = minutesBetween(now, start);
  const peakMm = Math.max(...wetIndexes.map((index) => intervals[index].precipitationMm));
  const peakIntensity = intensityForAmount(peakMm);
  const durationMinutes = minutesBetween(start, end);
  const confidence = confidenceFor(intervals, wetIndexes);
  const status = minutesUntil <= SLOT_MINUTES / 2 ? 'raining' : 'incoming';
  const onsetWindowStart = new Date(start.getTime() - 5 * 60_000).toISOString();
  const onsetWindowEnd = new Date(start.getTime() + 5 * 60_000).toISOString();
  const intensityCopy = peakIntensity === 'trace' ? 'Very light' : `${peakIntensity[0].toUpperCase()}${peakIntensity.slice(1)}`;
  const headline = status === 'raining'
    ? `${intensityCopy} rain now`
    : `Rain ${confidence.label === 'low' ? 'may arrive' : 'likely'} in ${Math.max(0, minutesUntil - 5)}–${minutesUntil + 5} minutes`;

  return {
    issuedAt: forecast.issuedAt,
    status,
    headline,
    detail: `${intensityCopy} rain may last ${durationLabel(durationMinutes)}.`,
    clearMinutes: minutesUntil,
    intervals,
    confidence,
    dataTier: 'standard',
    source: forecast.source,
    event: {
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      onsetWindowStart,
      onsetWindowEnd,
      peakIntensity,
      peakMm,
      durationMinutes,
    },
  };
}
