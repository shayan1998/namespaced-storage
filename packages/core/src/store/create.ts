import { createMemoryAdapter, createNoopAdapter } from '../adapters/memory.js';
import type { SyncAdapter } from '../adapters/types.js';
import { createWebStorageAdapter } from '../adapters/web-storage.js';
import { StorageUnavailableError, type NamespacedStorageError } from '../errors.js';
import { assertValidSegment } from '../namespace/key.js';
import type { StoreOptions, SyncNamespacedStore } from '../types.js';
import { createSyncStore } from './sync.js';

function segmentsFor(namespace: string, prefix: string | undefined): string[] {
  assertValidSegment(namespace, 'namespace');
  if (prefix === undefined) return [namespace];
  assertValidSegment(prefix, 'prefix', namespace);
  return [prefix, namespace];
}

/**
 * Availability is settled once, at construction. In the scenario that matters — server render,
 * then a fresh client runtime — each side probes its own environment, so a later change of heart
 * is not something a browser actually does.
 */
function resolveAdapter(
  requested: SyncAdapter,
  namespace: string,
  options: StoreOptions,
): { adapter: SyncAdapter; available: boolean } {
  if (requested.isAvailable()) return { adapter: requested, available: true };

  const fallback = options.fallback ?? 'memory';
  const error = new StorageUnavailableError(
    `${requested.name} is not available (no browser environment, private mode, or blocked by ` +
      `the embedding page). Falling back to "${fallback}".`,
    { namespace },
  );
  reportOnce(options.onError, error);

  if (fallback === 'throw') throw error;
  if (fallback === 'noop') return { adapter: createNoopAdapter(), available: false };
  return { adapter: createMemoryAdapter(`memory:${requested.name}`), available: false };
}

function reportOnce(
  onError: ((error: NamespacedStorageError) => void) | undefined,
  error: NamespacedStorageError,
): void {
  try {
    onError?.(error);
  } catch {
    /* the handler's problem, not ours */
  }
}

function create(
  requested: SyncAdapter,
  namespace: string,
  options: StoreOptions,
): SyncNamespacedStore {
  const segments = segmentsFor(namespace, options.prefix);
  const { adapter, available } = resolveAdapter(requested, namespace, options);
  return createSyncStore({ segments, adapter, available, options });
}

/**
 * A namespaced view over `localStorage`.
 *
 * ```ts
 * export const basket = createLocalStorage('basket');
 * basket.set('count', 10);   // writes "basket:count"
 * basket.clear();            // clears basket:* and nothing else
 * ```
 */
export function createLocalStorage(
  namespace: string,
  options: StoreOptions = {},
): SyncNamespacedStore {
  return create(createWebStorageAdapter('local'), namespace, options);
}

/** A namespaced view over `sessionStorage`. */
export function createSessionStorage(
  namespace: string,
  options: StoreOptions = {},
): SyncNamespacedStore {
  return create(createWebStorageAdapter('session'), namespace, options);
}

/** An in-memory namespaced store. Useful in tests and in non-browser runtimes. */
export function createMemoryStorage(
  namespace: string,
  options: StoreOptions = {},
): SyncNamespacedStore {
  return create(createMemoryAdapter(), namespace, options);
}
