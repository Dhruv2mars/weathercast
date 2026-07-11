import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  DATABASE_PATH: z.string().min(1).default('.data/weathercast.sqlite'),
  ARCHIVE_MODE: z.enum(['sqlite', 'postgres']).default('sqlite'),
  DATABASE_URL: z.string().min(1).optional(),
  NOWCAST_PROVIDER_MODE: z.enum(['open-meteo-evaluation', 'normalized-upstream']).default('open-meteo-evaluation'),
  OPEN_METEO_API_HOST: z.url().default('https://api.open-meteo.com'),
  NORMALIZED_UPSTREAM_URL: z.url().optional(),
  NORMALIZED_UPSTREAM_HEALTH_URL: z.url().optional(),
  NORMALIZED_UPSTREAM_TOKEN: z.string().min(16).optional(),
  CORS_ORIGIN: z.string().min(1).default('*'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(10_000).default(120),
  FORECAST_CACHE_SECONDS: z.coerce.number().int().min(30).max(900).default(240),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(8_000),
  READINESS_REQUIRE_PRECISION_DATA: z.enum(['true', 'false']).default('false')
    .transform((value) => value === 'true'),
  READINESS_RADAR_MAX_AGE_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  READINESS_OBSERVATION_MAX_AGE_SECONDS: z.coerce.number().int().min(300).max(14_400).default(7200),
  READINESS_MIN_RADAR_FRAMES: z.coerce.number().int().min(3).max(12).default(4),
  READINESS_MIN_OBSERVATION_STATIONS: z.coerce.number().int().min(1).max(500).default(10),
  READINESS_RADAR_DOMAIN: z.enum(['CONUS']).default('CONUS'),
  READINESS_RADAR_PRODUCT: z.enum(['PrecipRate_00.00']).default('PrecipRate_00.00'),
  READINESS_OBSERVATION_SOURCE: z.enum(['aviation-weather-metar'])
    .default('aviation-weather-metar'),
  READINESS_UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(500).max(5000).default(2000),
  READINESS_UPSTREAM_CACHE_SECONDS: z.coerce.number().int().min(1).max(60).default(15),
});

export type ApiConfig = z.infer<typeof environmentSchema>;

export function loadConfig(environment: Record<string, string | undefined> = process.env): ApiConfig {
  const config = environmentSchema.parse(environment);

  if (config.ARCHIVE_MODE === 'postgres') {
    if (!config.DATABASE_URL) throw new Error('PostgreSQL archive requires DATABASE_URL.');
    const database = new URL(config.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(database.protocol)) {
      throw new Error('PostgreSQL archive requires a PostgreSQL DATABASE_URL.');
    }
  }

  if (config.NOWCAST_PROVIDER_MODE === 'normalized-upstream'
      && (!config.NORMALIZED_UPSTREAM_URL
        || !config.NORMALIZED_UPSTREAM_HEALTH_URL
        || !config.NORMALIZED_UPSTREAM_TOKEN)) {
    throw new Error('normalized-upstream requires forecast URL, health URL, and token.');
  }
  if (config.NODE_ENV === 'production') {
    if (config.NOWCAST_PROVIDER_MODE === 'open-meteo-evaluation') {
      throw new Error('Production cannot use the non-commercial Open-Meteo evaluation provider.');
    }
    if (config.CORS_ORIGIN === '*') {
      throw new Error('Production requires an explicit CORS_ORIGIN.');
    }
    if (!config.READINESS_REQUIRE_PRECISION_DATA) {
      throw new Error('Production requires precision readiness checks to be enabled.');
    }
    if (config.ARCHIVE_MODE !== 'postgres' || !config.DATABASE_URL) {
      throw new Error('Production requires a PostgreSQL archive.');
    }
    const database = new URL(config.DATABASE_URL);
    if (!['require', 'verify-ca', 'verify-full'].includes(database.searchParams.get('sslmode') ?? '')) {
      throw new Error('Production requires a TLS PostgreSQL archive.');
    }
    const upstream = new URL(config.NORMALIZED_UPSTREAM_URL!);
    if (upstream.protocol !== 'https:') {
      throw new Error('Production normalized upstream must use HTTPS.');
    }
    if (upstream.hostname === 'api.open-meteo.com' || upstream.hostname.endsWith('.open-meteo.com')) {
      throw new Error('Production cannot route through the Open-Meteo open-access host.');
    }
    const health = new URL(config.NORMALIZED_UPSTREAM_HEALTH_URL!);
    if (health.protocol !== 'https:') {
      throw new Error('Production normalized upstream health URL must use HTTPS.');
    }
  }
  if (config.NOWCAST_PROVIDER_MODE === 'normalized-upstream') {
    const upstream = new URL(config.NORMALIZED_UPSTREAM_URL!);
    const health = new URL(config.NORMALIZED_UPSTREAM_HEALTH_URL!);
    if (health.origin !== upstream.origin) {
      throw new Error('Normalized upstream forecast and health URLs must use the same origin.');
    }
  }

  return config;
}
