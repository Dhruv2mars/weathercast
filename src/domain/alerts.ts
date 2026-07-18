import type { AlertPreferences, Nowcast } from '@/types/weather';

export type AlertPlan = {
  triggerAt: Date;
  title: string;
  body: string;
};

export function getAlertPlan(nowcast: Nowcast, preferences: AlertPreferences, now = new Date()): AlertPlan | null {
  if (!preferences.enabled || !nowcast.event || nowcast.status !== 'incoming') return null;
  if (nowcast.calibrationStatus === 'uncalibrated' || nowcast.expired || !nowcast.validUntil) return null;
  if (preferences.significantOnly && ['trace', 'light'].includes(nowcast.event.peakIntensity)) return null;

  const triggerAt = new Date(new Date(nowcast.event.startTime).getTime() - preferences.leadMinutes * 60_000);
  if (triggerAt.getTime() <= now.getTime()) return null;
  if (nowcast.validUntil && triggerAt.getTime() > new Date(nowcast.validUntil).getTime()) return null;

  const intensity = nowcast.event.peakIntensity === 'trace' ? 'Very light' : nowcast.event.peakIntensity;
  return {
    triggerAt,
    title: `Rain in about ${preferences.leadMinutes} minutes`,
    body: `${intensity[0].toUpperCase()}${intensity.slice(1)} rain is likely near your selected place. ${nowcast.confidence.label[0].toUpperCase()}${nowcast.confidence.label.slice(1)} confidence.`,
  };
}
