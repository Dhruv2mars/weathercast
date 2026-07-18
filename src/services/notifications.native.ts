import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

import type { AlertPlan } from '@/domain/alerts';
import { storage } from '@/lib/storage';

const ALERT_ID_KEY = 'weathercast.alert-id.v1';
const CHANNEL_ID = 'rain-alerts';

function isExpoGo() {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

async function getNotifications() {
  return import('expo-notifications');
}

export async function configureNotifications() {
  // Expo Go intentionally excludes Android notification support. Development
  // and production builds include the native module configured in app.json.
  if (isExpoGo()) return;
  const Notifications = await getNotifications();
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Rain alerts',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 160],
      sound: 'default',
    });
  }
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) {
    const preferences = storage.getPreferences();
    if (preferences.alerts.enabled) {
      storage.setPreferences({ ...preferences, alerts: { ...preferences.alerts, enabled: false } });
    }
  }
}

export async function requestNotificationPermission() {
  if (isExpoGo()) return false;
  const Notifications = await getNotifications();
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

let alertSyncQueue: Promise<void> = Promise.resolve();

async function performAlertSync(plan: AlertPlan | null) {
  if (isExpoGo()) return;
  const Notifications = await getNotifications();
  const previousId = localStorage.getItem(ALERT_ID_KEY);
  if (previousId) {
    try {
      await Notifications.cancelScheduledNotificationAsync(previousId);
    } catch {
      // Native cancellation can fail after the OS has already removed an alert.
    } finally {
      localStorage.removeItem(ALERT_ID_KEY);
    }
  }
  if (!plan) return;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) {
    const preferences = storage.getPreferences();
    if (preferences.alerts.enabled) {
      storage.setPreferences({ ...preferences, alerts: { ...preferences.alerts, enabled: false } });
    }
    return;
  }
  const id = await Notifications.scheduleNotificationAsync({
    content: { title: plan.title, body: plan.body, data: { route: '/' }, sound: 'default' },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: plan.triggerAt,
      channelId: Platform.OS === 'android' ? CHANNEL_ID : undefined,
    },
  });
  localStorage.setItem(ALERT_ID_KEY, id);
}

export function syncScheduledAlert(plan: AlertPlan | null) {
  const operation = alertSyncQueue.then(() => performAlertSync(plan));
  alertSyncQueue = operation.catch(() => undefined);
  return operation;
}
