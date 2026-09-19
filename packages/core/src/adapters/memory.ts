import type { SyncAdapter } from './types.js';

/**
 * Backing maps are shared per name so that two stores in the same runtime see each other's writes,
 * exactly as they would with real `localStorage`. The name also keeps the `local` and `session`
 * fallbacks from bleeding into one another.
 */
const stores = new Map<string, Map<string, string>>();

function backing(name: string): Map<string, string> {
  let map = stores.get(name);
  if (!map) {
    map = new Map();
    stores.set(name, map);
  }
  return map;
}

export function createMemoryAdapter(name = 'memory'): SyncAdapter {
  return {
    kind: 'sync',
    name,
    isAvailable: () => true,
    getItem: (key) => backing(name).get(key) ?? null,
    setItem: (key, value) => void backing(name).set(key, value),
    removeItem: (key) => void backing(name).delete(key),
    keys: () => [...backing(name).keys()],
  };
}

/** Test helper — drops every in-memory backing map. */
export function resetMemoryAdapters(): void {
  stores.clear();
}

/** Used by `fallback: 'noop'`: reads are empty, writes are discarded. */
export function createNoopAdapter(name = 'noop'): SyncAdapter {
  return {
    kind: 'sync',
    name,
    isAvailable: () => true,
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    keys: () => [],
  };
}
