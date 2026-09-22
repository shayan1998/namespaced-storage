import { createEmitter } from './emitter.js';
import type { SyncAdapter } from './types.js';

export type WebStorageKind = 'local' | 'session';

const PROBE_KEY = '__nss_probe__';

/**
 * Resolving the backing `Storage` is itself guarded, because reading
 * `window.localStorage` throws `SecurityError` outright in a cookie-blocked iframe — it does not
 * merely return undefined.
 */
function resolve(kind: WebStorageKind): Storage | null {
  try {
    const global = globalThis as { localStorage?: Storage; sessionStorage?: Storage };
    return (kind === 'local' ? global.localStorage : global.sessionStorage) ?? null;
  } catch {
    return null;
  }
}

/**
 * A round-trip probe rather than a truthiness check: Safari private mode exposes a perfectly normal
 * `localStorage` object whose very first `setItem` throws `QuotaExceededError` at zero bytes.
 */
function probe(kind: WebStorageKind): Storage | null {
  const storage = resolve(kind);
  if (!storage) return null;
  try {
    storage.setItem(PROBE_KEY, '1');
    const ok = storage.getItem(PROBE_KEY) === '1';
    storage.removeItem(PROBE_KEY);
    return ok ? storage : null;
  } catch {
    return null;
  }
}

export function createWebStorageAdapter(kind: WebStorageKind): SyncAdapter {
  // Probed lazily and memoised: construction usually happens at module-import time, which on a
  // server would otherwise permanently decide availability before the browser ever runs.
  let resolved: Storage | null | undefined;
  const storage = (): Storage | null => (resolved ??= probe(kind));

  const emitter = createEmitter();
  let detachNative: (() => void) | undefined;

  /**
   * The native `storage` event only fires in *other* tabs, so this covers remote changes; local
   * ones are emitted by setItem/removeItem below. It is attached on the first subscription and
   * dropped again with the last, so a store nobody listens to leaks no window listener.
   */
  const attachNative = (): (() => void) => {
    const target = globalThis as {
      addEventListener?: typeof window.addEventListener;
      removeEventListener?: typeof window.removeEventListener;
    };
    if (typeof target.addEventListener !== 'function') return () => {};

    const handler = (event: Event): void => {
      const storageEvent = event as StorageEvent;
      // `storage` fires for both areas, so a sessionStorage store would otherwise react to a
      // localStorage write that happened to use the same key.
      if (storageEvent.storageArea !== storage()) return;
      emitter.emit({
        key: storageEvent.key,
        newValue: storageEvent.newValue,
        oldValue: storageEvent.oldValue,
        source: 'remote',
      });
    };

    target.addEventListener('storage', handler);
    return () => target.removeEventListener?.('storage', handler);
  };

  return {
    kind: 'sync',
    name: kind === 'local' ? 'localStorage' : 'sessionStorage',

    isAvailable: () => storage() !== null,

    getItem(key) {
      try {
        return storage()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },

    // Deliberately unguarded: a failed write must surface, and the store layer turns a quota
    // failure into StorageQuotaError. Silently dropping writes is the worse bug.
    setItem(key, value) {
      // Capturing the previous value costs a read, so it is only paid for when observed.
      const oldValue = emitter.size > 0 ? this.getItem(key) : null;
      storage()?.setItem(key, value);
      if (emitter.size > 0) emitter.emit({ key, newValue: value, oldValue, source: 'local' });
    },

    removeItem(key) {
      const oldValue = emitter.size > 0 ? this.getItem(key) : null;
      try {
        storage()?.removeItem(key);
      } catch {
        /* a failed delete is not worth propagating */
      }
      if (oldValue !== null && emitter.size > 0) {
        emitter.emit({ key, newValue: null, oldValue, source: 'local' });
      }
    },

    keys() {
      try {
        const store = storage();
        if (!store) return [];
        const out: string[] = [];
        for (let i = 0; i < store.length; i++) {
          const key = store.key(i);
          if (key !== null) out.push(key);
        }
        return out;
      } catch {
        return [];
      }
    },

    subscribe(listener) {
      const remove = emitter.add(listener);
      detachNative ??= attachNative();
      return () => {
        remove();
        if (emitter.size === 0) {
          detachNative?.();
          detachNative = undefined;
        }
      };
    },
  };
}
