import { ForecastArchive } from './archive';
import type { ApiConfig } from './config';
import type { ForecastStore } from './forecast-store';
import { PostgresForecastStore } from './postgres-forecast-store';
import type { PrecisionIngestionStore } from './precision-ingestion-store';

export type WeathercastStore = ForecastStore & PrecisionIngestionStore;

export async function createWeathercastStore(
  config: Pick<ApiConfig, 'ARCHIVE_MODE' | 'DATABASE_URL' | 'DATABASE_PATH'>,
): Promise<WeathercastStore> {
  return config.ARCHIVE_MODE === 'postgres'
    ? PostgresForecastStore.create(config.DATABASE_URL!)
    : new ForecastArchive(config.DATABASE_PATH);
}
