export type RainIntensity = 'none' | 'trace' | 'light' | 'moderate' | 'heavy' | 'extreme';
export type ConfidenceLabel = 'low' | 'medium' | 'high';
export type DataTier = 'precision' | 'enhanced' | 'standard';

export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type Place = Coordinates & {
  id: string;
  name: string;
  admin?: string;
  country?: string;
  source: 'current' | 'search' | 'saved';
  locationSource?: 'live' | 'recent';
  locationTimestamp?: string;
};

export type ForecastInterval = {
  time: string;
  precipitationMm: number;
  rainMm: number;
  showersMm: number;
  probability: number;
  weatherCode: number;
};

export type NormalizedForecast = {
  issuedAt: string;
  timezone: string;
  source: string;
  intervals: ForecastInterval[];
};

export type RainEvent = {
  startTime: string;
  endTime: string;
  onsetWindowStart: string;
  onsetWindowEnd: string;
  peakIntensity: RainIntensity;
  peakMm: number;
  durationMinutes: number;
};

export type Nowcast = {
  issuedAt: string;
  status: 'clear' | 'incoming' | 'raining';
  headline: string;
  detail: string;
  clearMinutes: number;
  intervals: ForecastInterval[];
  confidence: {
    score: number;
    label: ConfidenceLabel;
    explanation: string;
  };
  dataTier: DataTier;
  source: string;
  event: RainEvent | null;
  schemaVersion?: 1;
  forecastId?: string;
  generatedAt?: string;
  validUntil?: string;
  timezone?: string;
  sourceDataTime?: string | null;
  calibrationStatus?: 'uncalibrated' | 'provisional' | 'calibrated';
  coverage?: {
    reason: string;
    spatialResolutionKm: number | null;
  };
};

export type AlertPreferences = {
  enabled: boolean;
  leadMinutes: 5 | 10 | 15 | 20 | 30;
  significantOnly: boolean;
};

export type Preferences = {
  alerts: AlertPreferences;
  onboardingComplete: boolean;
  selectedPlaceId: string;
};

export type RadarFrame = {
  time: number;
  path: string;
};

export type RadarManifest = {
  generated: number;
  host: string;
  frames: RadarFrame[];
};
