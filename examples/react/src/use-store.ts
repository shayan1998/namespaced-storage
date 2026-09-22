import { useCallback, useSyncExternalStore } from 'react';
import type { SyncNamespacedStore } from 'namespaced-storage';

/**
 * A store is already an external store in React's sense: it has a subscribe function and a
 * synchronous getter. That is the whole hook — no context, no provider, no copy of the state.
 *
 * `subscribe` fires for this tab and for other tabs, so two windows stay in step for free.
 */
export function useStoreValue<T>(store: SyncNamespacedStore, key: string): T | undefined {
  const subscribe = useCallback(
    (onChange: () => void) => store.subscribe(key, onChange),
    [store, key],
  );

  return useSyncExternalStore(
    subscribe,
    () => store.get<T>(key),
    // Server snapshot: storage does not exist there, so the default is the honest answer and
    // hydration has nothing to disagree about.
    () => undefined,
  );
}
