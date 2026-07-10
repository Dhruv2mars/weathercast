import type { AlertPlan } from '@/domain/alerts';

export async function configureNotifications() {}

export async function requestNotificationPermission() {
  return false;
}

export async function syncScheduledAlert(_plan: AlertPlan | null) {}
