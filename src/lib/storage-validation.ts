import type { Nowcast, Place } from '@/types/weather';

const placeSources = new Set<Place['source']>(['current', 'search', 'saved']);
const locationSources = new Set<NonNullable<Place['locationSource']>>(['live', 'recent']);
const statuses = new Set<Nowcast['status']>(['clear', 'incoming', 'raining']);
const confidenceLabels = new Set<Nowcast['confidence']['label']>(['low', 'medium', 'high']);
const dataTiers = new Set<Nowcast['dataTier']>(['precision', 'enhanced', 'standard']);
const calibrationStatuses = new Set<NonNullable<Nowcast['calibrationStatus']>>(['uncalibrated', 'provisional', 'calibrated']);
const intensities = new Set<NonNullable<Nowcast['event']>['peakIntensity']>(['none', 'trace', 'light', 'moderate', 'heavy', 'extreme']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === 'string';
}

export function isStoredPlace(value: unknown): value is Place {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || value.id.length === 0) return false;
  if (typeof value.name !== 'string' || value.name.length === 0) return false;
  if (!isFiniteNumber(value.latitude) || value.latitude < -90 || value.latitude > 90) return false;
  if (!isFiniteNumber(value.longitude) || value.longitude < -180 || value.longitude > 180) return false;
  if (typeof value.source !== 'string' || !placeSources.has(value.source as Place['source'])) return false;
  if (!isOptionalString(value.admin) || !isOptionalString(value.country)) return false;
  if (value.locationSource !== undefined
      && (typeof value.locationSource !== 'string' || !locationSources.has(value.locationSource as NonNullable<Place['locationSource']>))) return false;
  return value.locationTimestamp === undefined || isIsoDate(value.locationTimestamp);
}

export function parseStoredPlaces(value: unknown): Place[] {
  return Array.isArray(value) ? value.filter(isStoredPlace) : [];
}

function isForecastInterval(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isIsoDate(value.time)
    && isFiniteNumber(value.precipitationMm) && value.precipitationMm >= 0
    && isFiniteNumber(value.rainMm) && value.rainMm >= 0
    && isFiniteNumber(value.showersMm) && value.showersMm >= 0
    && isFiniteNumber(value.probability) && value.probability >= 0 && value.probability <= 100
    && isFiniteNumber(value.weatherCode);
}

function isRainEvent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const start = isIsoDate(value.startTime) ? new Date(value.startTime).getTime() : NaN;
  const end = isIsoDate(value.endTime) ? new Date(value.endTime).getTime() : NaN;
  return Number.isFinite(start)
    && Number.isFinite(end)
    && isIsoDate(value.onsetWindowStart)
    && isIsoDate(value.onsetWindowEnd)
    && end > start
    && new Date(value.onsetWindowEnd).getTime() >= new Date(value.onsetWindowStart).getTime()
    && typeof value.peakIntensity === 'string'
    && intensities.has(value.peakIntensity as NonNullable<Nowcast['event']>['peakIntensity'])
    && isFiniteNumber(value.peakMm) && value.peakMm >= 0
    && isFiniteNumber(value.durationMinutes)
    && value.durationMinutes >= 0
    && value.durationMinutes === Math.round((end - start) / 60_000);
}

export function isCachedNowcast(value: unknown): value is Nowcast {
  if (!isRecord(value)) return false;
  if (!isIsoDate(value.issuedAt)
      || typeof value.status !== 'string'
      || !statuses.has(value.status as Nowcast['status'])
      || typeof value.headline !== 'string' || value.headline.length === 0
      || typeof value.detail !== 'string' || value.detail.length === 0
      || !isFiniteNumber(value.clearMinutes) || value.clearMinutes < 0
      || !Array.isArray(value.intervals) || value.intervals.length !== 8
      || !value.intervals.every(isForecastInterval)
      || value.intervals.some((interval, index, intervals) => index > 0
        && new Date(interval.time).getTime() - new Date(intervals[index - 1].time).getTime() !== 15 * 60_000)
      || !isRecord(value.confidence)
      || !isFiniteNumber(value.confidence.score) || value.confidence.score < 0 || value.confidence.score > 100
      || typeof value.confidence.label !== 'string'
      || !confidenceLabels.has(value.confidence.label as Nowcast['confidence']['label'])
      || typeof value.confidence.explanation !== 'string' || value.confidence.explanation.length === 0
      || typeof value.dataTier !== 'string' || !dataTiers.has(value.dataTier as Nowcast['dataTier'])
      || typeof value.source !== 'string' || value.source.length === 0
      || (value.event !== null && !isRainEvent(value.event))) return false;
  if ((value.status === 'clear' && value.event !== null) || (value.status !== 'clear' && value.event === null)) return false;
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1) return false;
  if (value.forecastId !== undefined && (typeof value.forecastId !== 'string' || value.forecastId.length === 0)) return false;
  if (value.generatedAt !== undefined && !isIsoDate(value.generatedAt)) return false;
  if (value.validUntil !== undefined && !isIsoDate(value.validUntil)) return false;
  if (value.validUntil !== undefined && new Date(value.validUntil).getTime() < new Date(value.issuedAt).getTime()) return false;
  if (value.timezone !== undefined && typeof value.timezone !== 'string') return false;
  if (value.sourceDataTime !== undefined && value.sourceDataTime !== null && !isIsoDate(value.sourceDataTime)) return false;
  if (value.calibrationStatus !== undefined
      && (typeof value.calibrationStatus !== 'string' || !calibrationStatuses.has(value.calibrationStatus as NonNullable<Nowcast['calibrationStatus']>))) return false;
  if (value.calibrationStatus === 'uncalibrated' && (value.confidence.label !== 'low' || value.confidence.score !== 0)) return false;
  if (value.coverage !== undefined
      && (!isRecord(value.coverage)
        || typeof value.coverage.reason !== 'string'
        || (value.coverage.spatialResolutionKm !== null
          && (!isFiniteNumber(value.coverage.spatialResolutionKm) || value.coverage.spatialResolutionKm <= 0)))) return false;
  return true;
}
