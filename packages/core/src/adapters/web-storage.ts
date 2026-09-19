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
      storage()?.setItem(key, value);
    },

    removeItem(key) {
      try {
        storage()?.removeItem(key);
      } catch {
        /* a failed delete is not worth propagating */
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
  };
}
