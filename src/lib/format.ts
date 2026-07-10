import type { RainIntensity } from '@/types/weather';

export function formatRelativeUpdate(issuedAt: string, now = new Date()) {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(issuedAt).getTime()) / 60_000));
  if (minutes < 1) return 'Updated now';
  if (minutes === 1) return 'Updated 1 minute ago';
  return `Updated ${minutes} minutes ago`;
}

export function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

export function intensityLabel(intensity: RainIntensity) {
  return intensity === 'none' ? 'Dry' : `${intensity[0].toUpperCase()}${intensity.slice(1)}`;
}
