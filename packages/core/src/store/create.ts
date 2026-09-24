import { createMemoryAdapter, createNoopAdapter } from '../adapters/memory.js';
import type { SyncAdapter } from '../adapters/types.js';
import { type NamespacedStorageError, StorageUnavailableError } from '../errors.js';
import type { registerDevStore } from '../features/inspect.js';
import type { assertMigrationOptions, runMigration } from '../features/migrate.js';
import { assertValidSegment } from '../namespace/key.js';
import { registerNamespace } from '../namespace/registry.js';
import type { resolveTyping } from '../typing/resolve.js';
import type { StoreOptions, SyncNamespacedStore, TypedStoreOptions } from '../types.js';
import { createSyncStore } from './sync.js';

/**
 * What a build wires in above level 1. Each entry point hands this to {@link makeFactory}, and a
 * feature nothing references is a feature the bundler can drop — the only kind of tree-shaking
 * worth promising (ADR-025).
 */
export interface StoreFeatures {
  /** Turns `defaults` / `schema` into validators and default values. */
  typing?: typeof resolveTyping;
  migration?: {
    assert: typeof assertMigrationOptions;
    run: typeof runMigration;
  };
  /** Puts the store in the development-only global directory. */
  devtools?: typeof registerDevStore;
  /**
   * Refuses the options this build has no code for. It lives in the entry point that needs it, so
   * the build that supports everything does not carry the rejection message.
   */
  guard?: (options: TypedStoreOptions, namespace: string) => void;
}

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
  features: StoreFeatures,
): SyncNamespacedStore {
  features.guard?.(options, namespace);

  const segments = segmentsFor(namespace, options.prefix);
  const typing = features.typing?.(namespace, options.defaults, options.schema);
  const { adapter, available } = resolveAdapter(requested, namespace, options);

  // Built first so that a malformed option — a bad ttl, a default contradicting its schema —
  // reports its own specific problem rather than a namespace conflict it tripped over on the way.
  const store = createSyncStore({ segments, adapter, available, options, typing });
  features.migration?.assert(options, store.namespace);

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
  features.migration?.run({
    segments,
    adapter,
    options,
    store,
    report: (error) => reportOnce(options.onError, error),
  });

  features.devtools?.(store);

  return store;
}

/** Builds one factory over one backend, wired with whatever the entry point supports. */
export function makeFactory(
  adapter: () => SyncAdapter,
  features: StoreFeatures,
): (namespace: string, options?: StoreOptions) => SyncNamespacedStore {
  return (namespace, options = {}) => create(adapter(), namespace, options, features);
}
