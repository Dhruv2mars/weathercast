import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  DATABASE_PATH: z.string().min(1).default('.data/weathercast.sqlite'),
  NOWCAST_PROVIDER_MODE: z.enum(['open-meteo-evaluation', 'normalized-upstream']).default('open-meteo-evaluation'),
  OPEN_METEO_API_HOST: z.url().default('https://api.open-meteo.com'),
  NORMALIZED_UPSTREAM_URL: z.url().optional(),
  NORMALIZED_UPSTREAM_TOKEN: z.string().min(16).optional(),
  CORS_ORIGIN: z.string().min(1).default('*'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(10_000).default(120),
  FORECAST_CACHE_SECONDS: z.coerce.number().int().min(30).max(900).default(240),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(8_000),
});

export type ApiConfig = z.infer<typeof environmentSchema>;

export function loadConfig(environment: Record<string, string | undefined> = process.env): ApiConfig {
  const config = environmentSchema.parse(environment);

  if (config.NOWCAST_PROVIDER_MODE === 'normalized-upstream'
      && (!config.NORMALIZED_UPSTREAM_URL || !config.NORMALIZED_UPSTREAM_TOKEN)) {
    throw new Error('normalized-upstream requires NORMALIZED_UPSTREAM_URL and NORMALIZED_UPSTREAM_TOKEN.');
  }

  if (config.NODE_ENV === 'production') {
    if (config.NOWCAST_PROVIDER_MODE === 'open-meteo-evaluation') {
      throw new Error('Production cannot use the non-commercial Open-Meteo evaluation provider.');
    }
    if (config.CORS_ORIGIN === '*') {
      throw new Error('Production requires an explicit CORS_ORIGIN.');
    }
    const upstream = new URL(config.NORMALIZED_UPSTREAM_URL!);
    if (upstream.protocol !== 'https:') {
      throw new Error('Production normalized upstream must use HTTPS.');
    }
    if (upstream.hostname === 'api.open-meteo.com' || upstream.hostname.endsWith('.open-meteo.com')) {
      throw new Error('Production cannot route through the Open-Meteo open-access host.');
    }
  }

  return config;
}
