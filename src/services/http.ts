import { fetch } from 'expo/fetch';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function requestJson(url: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 10_000);
  try {
    const response = await fetch(url, {
      ...init,
      headers: { Accept: 'application/json', ...init.headers },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ApiError(`Weather service returned ${response.status}.`, response.status, 'HTTP_ERROR');
    }
    return await response.json();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError(timedOut ? 'Weather request timed out.' : 'Weather request was cancelled.', 0, timedOut ? 'TIMEOUT' : 'CANCELLED');
    }
    throw new ApiError('Could not reach the weather service.', 0, 'NETWORK_ERROR');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  return requestJson(url, { method: 'GET' }, signal);
}

export function postJson(url: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  return requestJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, signal);
}
