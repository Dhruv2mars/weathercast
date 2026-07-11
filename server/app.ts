import { buildNowcast } from '@/domain/nowcast';

import { createForecastId, locationCell, type NowcastEnvelope } from './archive';
import type { ApiConfig } from './config';
import { coordinatesSchema } from './contracts';
import type { ForecastStore } from './forecast-store';
import type { ForecastProvider } from './providers';
import { FixedWindowRateLimiter } from './rate-limit';
import { selectStudyRadarFrames } from './study-issuance';

type Dependencies = {
  config: ApiConfig;
  archive: ForecastStore;
  provider: ForecastProvider;
  now?: () => Date;
};

class ServiceError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
  }
}

function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(body, { status, headers });
}

function requestIp(request: Request) {
  return request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? 'unknown';
}

function withCommonHeaders(response: Response, requestId: string, origin: string) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Headers', 'Accept, Content-Type');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Request-ID', requestId);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function forecastResponse(envelope: NowcastEnvelope, request: Request, cache: 'HIT' | 'MISS') {
  const etag = `"${envelope.forecastId}"`;
  const headers = {
    'Cache-Control': 'private, max-age=60, stale-if-error=300',
    ETag: etag,
    'X-Weathercast-Cache': cache,
    'X-Forecast-ID': envelope.forecastId,
    'X-Data-Tier': envelope.dataTier,
    'X-Issued-At': envelope.issuedAt,
  };
  return request.headers.get('If-None-Match') === etag
    ? new Response(null, { status: 304, headers })
    : json(envelope, 200, headers);
}

export function createHandler({ config, archive, provider, now = () => new Date() }: Dependencies) {
  const limiter = new FixedWindowRateLimiter(config.RATE_LIMIT_PER_MINUTE);
  const inFlight = new Map<string, Promise<NowcastEnvelope>>();
  let upstreamReadiness: { healthy: boolean; expiresAt: number } | undefined;
  let upstreamReadinessProbe: Promise<boolean> | undefined;

  async function checkUpstreamReadiness() {
    if (upstreamReadiness && upstreamReadiness.expiresAt > performance.now()) {
      return upstreamReadiness.healthy;
    }
    if (!upstreamReadinessProbe) {
      upstreamReadinessProbe = (async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.READINESS_UPSTREAM_TIMEOUT_MS);
        try {
          return await provider.checkHealth(controller.signal) === true;
        } catch {
          return false;
        } finally {
          clearTimeout(timeout);
        }
      })();
    }
    try {
      const healthy = await upstreamReadinessProbe;
      upstreamReadiness = {
        healthy,
        expiresAt: performance.now() + config.READINESS_UPSTREAM_CACHE_SECONDS * 1000,
      };
      return healthy;
    } finally {
      upstreamReadinessProbe = undefined;
    }
  }

  async function issueForecast(cell: string, latitude: number, longitude: number, generatedAt: Date) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.UPSTREAM_TIMEOUT_MS);
    try {
      const result = await provider.fetch({ latitude, longitude }, controller.signal);
      const rawNowcast = buildNowcast(result.forecast, generatedAt);
      const nowcast = result.calibrationStatus === 'calibrated'
        ? rawNowcast
        : {
            ...rawNowcast,
            confidence: {
              score: 0,
              label: 'low' as const,
              explanation: 'Timing confidence is not yet calibrated for this coverage tier.',
            },
          };
      const validUntil = new Date(generatedAt.getTime() + config.FORECAST_CACHE_SECONDS * 1000).toISOString();
      const forecastId = createForecastId(cell, result.provider, result.forecast.issuedAt, nowcast);
      const envelope: NowcastEnvelope = {
        ...nowcast,
        schemaVersion: 1,
        forecastId,
        generatedAt: generatedAt.toISOString(),
        validUntil,
        timezone: result.forecast.timezone,
        sourceDataTime: null,
        dataTier: result.dataTier,
        calibrationStatus: result.calibrationStatus,
        coverage: {
          reason: result.coverageReason,
          spatialResolutionKm: result.spatialResolutionKm,
        },
      };
      try {
        return await archive.save({
          envelope,
          cell,
          latitude: Number(latitude.toFixed(4)),
          longitude: Number(longitude.toFixed(4)),
          provider: result.provider,
          upstreamRunId: result.upstreamRunId,
        });
      } catch {
        throw new ServiceError('ARCHIVE_UNAVAILABLE', 503, 'Forecast archive is unavailable.');
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  return async function handle(request: Request) {
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);
    let response: Response;

    if (request.method === 'OPTIONS') {
      response = new Response(null, { status: 204 });
      return withCommonHeaders(response, requestId, config.CORS_ORIGIN);
    }

    if (request.method === 'GET' && url.pathname === '/healthz') {
      response = json({ status: 'ok' });
      return withCommonHeaders(response, requestId, config.CORS_ORIGIN);
    }

    if (request.method === 'GET' && url.pathname === '/readyz') {
      const archiveReady = await archive.isReady();
      const checks: Record<string, 'pass' | 'fail'> = {
        archive: archiveReady ? 'pass' : 'fail',
      };
      if (config.READINESS_REQUIRE_PRECISION_DATA) {
        const checkedAt = now();
        const through = checkedAt.toISOString();
        const observationSince = new Date(
          checkedAt.getTime() - config.READINESS_OBSERVATION_MAX_AGE_SECONDS * 1000,
        ).toISOString();
        let radarReady = false;
        if (archiveReady) {
          try {
            selectStudyRadarFrames({
              newestFirst: await archive.listRadarFrames(
                config.READINESS_RADAR_DOMAIN,
                config.READINESS_RADAR_PRODUCT,
                config.READINESS_MIN_RADAR_FRAMES,
              ),
              expectedCount: config.READINESS_MIN_RADAR_FRAMES,
              now: checkedAt,
              maximumAgeSeconds: config.READINESS_RADAR_MAX_AGE_SECONDS,
            });
            radarReady = true;
          } catch {
            radarReady = false;
          }
        }
        checks.radar = radarReady ? 'pass' : 'fail';
        let observationsReady = false;
        if (archiveReady) {
          try {
            observationsReady = await archive.countRecentVerifiedObservationStations(
              config.READINESS_OBSERVATION_SOURCE,
              observationSince,
              through,
            ) >= config.READINESS_MIN_OBSERVATION_STATIONS;
          } catch {
            observationsReady = false;
          }
        }
        checks.observations = observationsReady ? 'pass' : 'fail';
      }
      if (config.NOWCAST_PROVIDER_MODE === 'normalized-upstream') {
        checks.upstream = await checkUpstreamReadiness() ? 'pass' : 'fail';
      }
      const ready = Object.values(checks).every((status) => status === 'pass');
      response = json({ status: ready ? 'ready' : 'not_ready', checks }, ready ? 200 : 503);
      return withCommonHeaders(response, requestId, config.CORS_ORIGIN);
    }

    const isNowcastRequest = url.pathname === '/v1/nowcast' && ['GET', 'POST'].includes(request.method);
    if (!isNowcastRequest) {
      response = json({ code: 'NOT_FOUND', message: 'Route not found.', requestId }, 404);
      return withCommonHeaders(response, requestId, config.CORS_ORIGIN);
    }

    const rate = limiter.take(requestIp(request));
    if (!rate.allowed) {
      response = json({ code: 'RATE_LIMITED', message: 'Too many requests. Try again shortly.', requestId }, 429, {
        'Retry-After': Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000)).toString(),
      });
      return withCommonHeaders(response, requestId, config.CORS_ORIGIN);
    }

    if (config.NODE_ENV === 'production' && request.method === 'GET') {
      response = json({ code: 'METHOD_NOT_ALLOWED', message: 'Use POST for location privacy.', requestId }, 405, { Allow: 'POST' });
      return withCommonHeaders(response, requestId, config.CORS_ORIGIN);
    }

    const coordinateInput = request.method === 'POST'
      ? await request.json().catch(() => ({}))
      : {
          latitude: url.searchParams.get('latitude'),
          longitude: url.searchParams.get('longitude'),
        };
    const parsedCoordinates = coordinatesSchema.safeParse(coordinateInput);
    if (!parsedCoordinates.success) {
      response = json({ code: 'INVALID_COORDINATES', message: 'Valid latitude and longitude are required.', requestId }, 400);
      return withCommonHeaders(response, requestId, config.CORS_ORIGIN);
    }

    const coordinates = parsedCoordinates.data;
    const cell = locationCell(coordinates.latitude, coordinates.longitude);
    const generatedAt = now();
    const cached = await archive.findFresh(cell, generatedAt);
    if (cached) {
      response = forecastResponse(cached, request, 'HIT');
      return withCommonHeaders(response, requestId, config.CORS_ORIGIN);
    }

    try {
      let pending = inFlight.get(cell);
      if (!pending) {
        pending = issueForecast(cell, coordinates.latitude, coordinates.longitude, generatedAt);
        inFlight.set(cell, pending);
      }
      const envelope = await pending;
      response = forecastResponse(envelope, request, 'MISS');
    } catch (error) {
      if (error instanceof ServiceError) {
        response = json({ code: error.code, message: error.message, requestId }, error.status);
        return withCommonHeaders(response, requestId, config.CORS_ORIGIN);
      }
      const timedOut = error instanceof DOMException && error.name === 'AbortError';
      response = json({
        code: timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
        message: timedOut ? 'Forecast source timed out.' : 'Forecast source is temporarily unavailable.',
        requestId,
      }, timedOut ? 504 : 502);
    } finally {
      inFlight.delete(cell);
    }
    return withCommonHeaders(response, requestId, config.CORS_ORIGIN);
  };
}
