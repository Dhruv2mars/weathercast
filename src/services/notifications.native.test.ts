import { describe, expect, mock, test } from 'bun:test';

let resolveCancellation!: () => void;
const cancelScheduledNotificationAsync = mock(() => new Promise<void>((resolve) => {
  resolveCancellation = resolve;
}));
const scheduleNotificationAsync = mock(() => Promise.resolve('replacement-alert'));

mock.module('expo-constants', () => ({
  default: { executionEnvironment: 'standalone' },
  ExecutionEnvironment: { StoreClient: 'store-client' },
}));
mock.module('react-native', () => ({ Platform: { OS: 'android' } }));
const getPermissionsAsync = mock(() => Promise.resolve({ granted: true }));

mock.module('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
  cancelScheduledNotificationAsync,
  getPermissionsAsync,
  scheduleNotificationAsync,
  setNotificationChannelAsync: mock(() => Promise.resolve()),
  setNotificationHandler: mock(() => undefined),
}));

const preferences = {
  alerts: { enabled: true, leadMinutes: 15 as const, significantOnly: false },
  onboardingComplete: true,
  selectedPlaceId: 'current',
};
const setPreferences = mock(() => undefined);
mock.module('@/lib/storage', () => ({
  storage: {
    getPreferences: () => preferences,
    setPreferences,
  },
}));

const values = new Map<string, string>([['weathercast.alert-id.v1', 'old-alert']]);
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
});

const { syncScheduledAlert } = await import('@/services/notifications.native');

describe('syncScheduledAlert', () => {
  test('serializes cancellation before scheduling a replacement', async () => {
    const cancel = syncScheduledAlert(null);
    const replacement = syncScheduledAlert({
      triggerAt: new Date('2026-07-16T13:00:00.000Z'),
      title: 'Rain soon',
      body: 'Moderate rain expected.',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancelScheduledNotificationAsync).toHaveBeenCalledWith('old-alert');
    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(0);

    resolveCancellation();
    await cancel;
    await replacement;

    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(values.get('weathercast.alert-id.v1')).toBe('replacement-alert');
  });

  test('clears a failed cancellation before scheduling a replacement', async () => {
    values.set('weathercast.alert-id.v1', 'stale-alert');
    cancelScheduledNotificationAsync.mockImplementationOnce(() => Promise.reject(new Error('native failure')));
    scheduleNotificationAsync.mockClear();

    await syncScheduledAlert({
      triggerAt: new Date('2026-07-16T13:30:00.000Z'),
      title: 'Rain soon',
      body: 'Moderate rain expected.',
    });

    expect(cancelScheduledNotificationAsync).toHaveBeenCalledWith('stale-alert');
    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(values.get('weathercast.alert-id.v1')).toBe('replacement-alert');
  });

  test('does not schedule when notification permission was revoked', async () => {
    values.delete('weathercast.alert-id.v1');
    getPermissionsAsync.mockImplementationOnce(() => Promise.resolve({ granted: false }));
    scheduleNotificationAsync.mockClear();

    await syncScheduledAlert({
      triggerAt: new Date('2026-07-16T13:45:00.000Z'),
      title: 'Rain soon',
      body: 'Moderate rain expected.',
    });

    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(0);
    expect(values.get('weathercast.alert-id.v1')).toBeUndefined();
    expect(setPreferences).toHaveBeenCalledWith({
      ...preferences,
      alerts: { ...preferences.alerts, enabled: false },
    });
  });
});
