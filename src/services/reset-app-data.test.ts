import { describe, expect, mock, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';

const clearAll = mock(() => undefined);
const syncScheduledAlert = mock(() => Promise.resolve());

mock.module('@/lib/storage', () => ({ storage: { clearAll } }));
mock.module('@/services/notifications', () => ({ syncScheduledAlert }));

const { resetAppData } = await import('@/services/reset-app-data');

describe('resetAppData', () => {
  test('clears query and persistent state after alert cancellation succeeds', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['current-place'], { id: 'current' });
    queryClient.setQueryData(['nowcast', '28.614,77.209'], { headline: 'Dry' });

    await resetAppData(queryClient);

    expect(syncScheduledAlert).toHaveBeenCalledWith(null);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(clearAll).toHaveBeenCalledTimes(1);
  });
});
