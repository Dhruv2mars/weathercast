import type { QueryClient } from '@tanstack/react-query';

import { storage } from '@/lib/storage';
import { syncScheduledAlert } from '@/services/notifications';

export async function resetAppData(queryClient: QueryClient) {
  await queryClient.cancelQueries();
  await syncScheduledAlert(null);
  storage.clearAll();
  queryClient.clear();
}
