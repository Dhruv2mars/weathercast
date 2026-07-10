import { fetch } from 'expo/fetch';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!response.ok) {
      throw new ApiError(`Weather service returned ${response.status}.`, response.status, 'HTTP_ERROR');
    }
    return await response.json();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError('Weather request timed out.', 0, 'TIMEOUT');
    }
    throw new ApiError('Could not reach the weather service.', 0, 'NETWORK_ERROR');
  }
}
