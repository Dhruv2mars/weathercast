import { z } from 'zod';

import type { Preferences } from '@/types/weather';

export const DEFAULT_PREFERENCES: Preferences = {
  alerts: { enabled: false, leadMinutes: 15, significantOnly: false },
  onboardingComplete: false,
  selectedPlaceId: 'current',
};

const leadMinutes = z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20), z.literal(30)]).catch(15);
const schema = z.object({
  alerts: z.object({
    enabled: z.boolean().catch(false),
    leadMinutes,
    significantOnly: z.boolean().catch(false),
  }).catch(DEFAULT_PREFERENCES.alerts),
  onboardingComplete: z.boolean().catch(false),
  selectedPlaceId: z.string().min(1).catch('current'),
});

export function parsePreferences(raw: string | null): Preferences {
  if (!raw) return DEFAULT_PREFERENCES;
  try {
    return schema.parse(JSON.parse(raw));
  } catch {
    return DEFAULT_PREFERENCES;
  }
}
