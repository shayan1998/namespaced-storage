/**
 * Level 1 and nothing else: namespacing, values, TTL, events, the conflict guard and `inspect()`.
 *
 * ```ts
 * import { createLocalStorage } from 'namespaced-storage/minimal';
 * ```
 *
 * The typing resolver and the migration engine are not wired in here, so a bundler leaves them
 * out — about 1.2 kB against a level-1 bundle from the main entry point. `defaults`, `schema`,
 * `version` and `migrate` throw rather than doing nothing quietly; import from
 * `namespaced-storage` when you want them (ADR-025).
 */
import { InvalidOptionsError } from './errors.js';
import { createMemoryAdapter } from './adapters/memory.js';
import type { SyncAdapter } from './adapters/types.js';
import { createWebStorageAdapter } from './adapters/web-storage.js';
import { makeFactory } from './store/create.js';
import type { StoreOptions, SyncNamespacedStore } from './types.js';

/** `StoreOptions` without the two this build cannot honour. */
export type MinimalStoreOptions = Omit<StoreOptions, 'version' | 'migrate'>;

export type MinimalFactory = (
  namespace: string,
  options?: MinimalStoreOptions,
) => SyncNamespacedStore;

const UNSUPPORTED = ['defaults', 'schema', 'version', 'migrate'] as const;

/**
 * An option this build has no code for is refused by name, pointing at the entry point that does
 * support it. Accepting it and doing nothing is how a `migrate` that never runs ships (ADR-022).
 */
function guard(options: object, namespace: string): void {
  for (const name of UNSUPPORTED) {
    if ((options as Record<string, unknown>)[name] === undefined) continue;
    throw new InvalidOptionsError(
      `"${name}" is not supported by namespaced-storage/minimal — import the factories from ` +
        `"namespaced-storage" instead. This entry point exists to leave that code out.`,
      { namespace },
    );
  }
}

const factory = (adapter: () => SyncAdapter): MinimalFactory => makeFactory(adapter, { guard });

/** A namespaced view over `localStorage`. Untyped: declare keys from the main entry point. */
export const createLocalStorage: MinimalFactory = factory(() => createWebStorageAdapter('local'));

/** A namespaced view over `sessionStorage`. */
export const createSessionStorage: MinimalFactory = factory(() =>
  createWebStorageAdapter('session'),
);

/** An in-memory namespaced store, for tests and non-browser runtimes. */
export const createMemoryStorage: MinimalFactory = factory(() => createMemoryAdapter());

export type {
  ChangeEvent,
  CorruptPolicy,
  EntryMeta,
  FallbackPolicy,
  InvalidPolicy,
  SetOptions,
  StoreOptions,
  SyncNamespacedStore,
  TrySetResult,
  Unsubscribe,
} from './types.js';

export {
  DecodeError,
  InvalidKeyError,
  InvalidNamespaceError,
  InvalidOptionsError,
  NamespaceConflictError,
  NamespacedStorageError,
  SerializationError,
  StorageQuotaError,
  StorageUnavailableError,
  SubscriberError,
  type ErrorCode,
} from './errors.js';

export { resetNamespaceRegistry } from './namespace/registry.js';
export { resetMemoryAdapters } from './adapters/memory.js';
