import { createMemoryAdapter, createNoopAdapter } from '../adapters/memory.js';
import type { SyncAdapter } from '../adapters/types.js';
import { createWebStorageAdapter } from '../adapters/web-storage.js';
import { type NamespacedStorageError, StorageUnavailableError } from '../errors.js';
import { registerDevStore } from '../features/inspect.js';
import { assertMigrationOptions, runMigration } from '../features/migrate.js';
import { assertValidSegment } from '../namespace/key.js';
import { registerNamespace } from '../namespace/registry.js';
import type { DefaultedKeys, StoreValues } from '../typing/infer.js';
import { resolveTyping } from '../typing/resolve.js';
import type {
  StoreOptions,
  SyncNamespacedStore,
  TypedStoreOptions,
  TypedSyncNamespacedStore,
} from '../types.js';
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
  options: TypedStoreOptions<Record<string, unknown>, Record<string, unknown>>,
): SyncNamespacedStore {
  const segments = segmentsFor(namespace, options.prefix);
  const typing = resolveTyping(namespace, options.defaults, options.schema);
  const { adapter, available } = resolveAdapter(requested, namespace, options);

  // Built first so that a malformed option — a bad ttl, a default contradicting its schema —
  // reports its own specific problem rather than a namespace conflict it tripped over on the way.
  const store = createSyncStore({ segments, adapter, available, options, typing });
  assertMigrationOptions(options, store.namespace);

  registerNamespace({
    path: segments.join(options.separator ?? ':'),
    // The *requested* backend, not the resolved one: localStorage and sessionStorage may each
    // hold a namespace of the same name, and a memory fallback must not change that identity.
    backend: requested.name,
    strict: options.strict,
    report: (error) => reportOnce(options.onError, error),
  });

  // Last, because it is the first thing here that writes: everything above validates, and a
  // namespace claimed twice must be caught before its data is migrated twice (ADR-022).
  runMigration({
    segments,
    adapter,
    options,
    store,
    report: (error) => reportOnce(options.onError, error),
  });

  registerDevStore(store);

  return store;
}

/**
 * No declarations at all, so `keyof Empty` is `never` and the inference helpers stay neutral
 * when only one of `defaults` / `schema` is supplied. `Record<string, never>` cannot be used
 * here: its `keyof` is `string`, which would make `Omit` strip every key.
 */
type Empty = Record<never, never>;

/** Shared by the three factories: untyped unless `defaults` or `schema` is given. */
type Factory = {
  (namespace: string, options?: StoreOptions): SyncNamespacedStore;
  <D extends Record<string, unknown> = Empty, S extends Record<string, unknown> = Empty>(
    namespace: string,
    options: TypedStoreOptions<D, S> & ({ defaults: D } | { schema: S }),
  ): TypedSyncNamespacedStore<StoreValues<D, S>, DefaultedKeys<D, S>>;
};

function factory(adapter: () => SyncAdapter): Factory {
  return ((namespace: string, options: TypedStoreOptions = {}) =>
    create(adapter(), namespace, options)) as Factory;
}

/**
 * A namespaced view over `localStorage`.
 *
 * ```ts
 * export const basket = createLocalStorage('basket');
 * basket.set('count', 10);   // writes "basket:count"
 * basket.clear();            // clears basket:* and nothing else
 * ```
 *
 * Declare `defaults` (and/or `schema`) to get typed keys and values:
 *
 * ```ts
 * export const basket = createLocalStorage('basket', {
 *   defaults: { count: 0, lastOpened: new Date() },
 * });
 * basket.get('count'); // number — not number | undefined
 * ```
 */
export const createLocalStorage: Factory = factory(() => createWebStorageAdapter('local'));

/** A namespaced view over `sessionStorage`. Takes the same options. */
export const createSessionStorage: Factory = factory(() => createWebStorageAdapter('session'));

/** An in-memory namespaced store. Useful in tests and in non-browser runtimes. */
export const createMemoryStorage: Factory = factory(() => createMemoryAdapter());
