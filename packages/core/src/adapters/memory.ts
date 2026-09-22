import { createEmitter } from './emitter.js';
import type { SyncAdapter } from './types.js';

/**
 * Backing maps are shared per name so that two stores in the same runtime see each other's writes,
 * exactly as they would with real `localStorage`. The name also keeps the `local` and `session`
 * fallbacks from bleeding into one another.
 */
const stores = new Map<string, Map<string, string>>();
const emitters = new Map<string, ReturnType<typeof createEmitter>>();

function backing(name: string): Map<string, string> {
  let map = stores.get(name);
  if (!map) {
    map = new Map();
    stores.set(name, map);
  }
  return map;
}

/** Shared per name too, so two stores over the same memory backing observe each other. */
function emitterFor(name: string) {
  let emitter = emitters.get(name);
  if (!emitter) {
    emitter = createEmitter();
    emitters.set(name, emitter);
  }
  return emitter;
}

export function createMemoryAdapter(name = 'memory'): SyncAdapter {
  return {
    kind: 'sync',
    name,
    isAvailable: () => true,
    getItem: (key) => backing(name).get(key) ?? null,

    setItem(key, value) {
      const emitter = emitterFor(name);
      const oldValue = emitter.size > 0 ? (backing(name).get(key) ?? null) : null;
      backing(name).set(key, value);
      if (emitter.size > 0) emitter.emit({ key, newValue: value, oldValue, source: 'local' });
    },

    removeItem(key) {
      const emitter = emitterFor(name);
      const oldValue = emitter.size > 0 ? (backing(name).get(key) ?? null) : null;
      const existed = backing(name).delete(key);
      if (existed && emitter.size > 0) {
        emitter.emit({ key, newValue: null, oldValue, source: 'local' });
      }
    },

    keys: () => [...backing(name).keys()],
    subscribe: (listener) => emitterFor(name).add(listener),
  };
}

/** Test helper — drops every in-memory backing map and its listeners. */
export function resetMemoryAdapters(): void {
  stores.clear();
  emitters.clear();
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
