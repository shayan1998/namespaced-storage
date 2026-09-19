import type { SyncAdapter } from '../adapters/types.js';
import { decode, encode } from '../codec/envelope.js';
import { approximateBytes, formatBytes } from '../codec/size.js';
import {
  DecodeError,
  NamespacedStorageError,
  StorageQuotaError,
  StorageUnavailableError,
  isQuotaError,
} from '../errors.js';
import {
  assertValidKey,
  assertValidSegment,
  createKeyCodec,
  isReservedKey,
} from '../namespace/key.js';
import type { CorruptPolicy, StoreOptions, SyncNamespacedStore, TrySetResult } from '../types.js';

export interface StoreContext {
  /** `[prefix?, namespace, ...children]`, already ordered. */
  segments: readonly string[];
  adapter: SyncAdapter;
  /** Whether the *requested* backend was available, as opposed to the fallback now in use. */
  available: boolean;
  options: StoreOptions;
}

export function createSyncStore(context: StoreContext): SyncNamespacedStore {
  const { segments, adapter, available, options } = context;
  const separator = options.separator;
  const codec = createKeyCodec(separator === undefined ? { segments } : { segments, separator });
  const onCorrupt: CorruptPolicy = options.onCorrupt ?? 'ignore';
  const path = codec.path;

  /** A throwing `onError` handler must never take the storage call down with it. */
  const report = (error: NamespacedStorageError): void => {
    try {
      options.onError?.(error);
    } catch {
      /* the handler's problem, not ours */
    }
  };

  const namespacedKeys = (): string[] => {
    const out: string[] = [];
    for (const rawKey of adapter.keys()) {
      const key = codec.decode(rawKey);
      if (key !== null && !isReservedKey(key)) out.push(key);
    }
    return out;
  };

  const store: SyncNamespacedStore = {
    namespace: path,
    adapter: adapter.name,
    available,

    set(key, value) {
      assertValidKey(key, path);
      if (value === undefined) {
        store.remove(key);
        return;
      }
      const raw = encode(value, path, key);
      const fullKey = codec.encode(key);
      try {
        adapter.setItem(fullKey, raw);
      } catch (cause) {
        const error = isQuotaError(cause)
          ? new StorageQuotaError(
              `Quota exceeded writing "${fullKey}" (${formatBytes(approximateBytes(raw))}). ` +
                `${adapter.name} is full.`,
              { namespace: path, key, cause },
            )
          : new StorageUnavailableError(`Could not write "${fullKey}".`, {
              namespace: path,
              key,
              cause,
            });
        report(error);
        throw error;
      }
    },

    get<T>(key: string): T | undefined {
      assertValidKey(key, path);
      const fullKey = codec.encode(key);
      const raw = adapter.getItem(fullKey);
      if (raw === null) return undefined;
      try {
        return decode(raw, path, key).value as T;
      } catch (error) {
        if (!(error instanceof DecodeError)) throw error;
        report(error);
        if (onCorrupt === 'throw') throw error;
        if (onCorrupt === 'remove') adapter.removeItem(fullKey);
        return undefined;
      }
    },

    remove(key) {
      assertValidKey(key, path);
      adapter.removeItem(codec.encode(key));
    },

    has(key) {
      assertValidKey(key, path);
      return adapter.getItem(codec.encode(key)) !== null;
    },

    clear() {
      // Never the native clear(): that would wipe every other namespace on the origin.
      // Reserved bookkeeping keys go too — a clear is a full reset of this namespace.
      for (const rawKey of adapter.keys()) {
        if (codec.decode(rawKey) !== null) adapter.removeItem(rawKey);
      }
    },

    keys: namespacedKeys,

    entries() {
      return namespacedKeys().map((key) => [key, store.get(key)] as [string, unknown]);
    },

    get size() {
      return namespacedKeys().length;
    },

    setItem: (key, value) => store.set(key, value),
    getItem: <T>(key: string) => store.get<T>(key),
    removeItem: (key) => store.remove(key),

    trySet(key, value): TrySetResult {
      try {
        store.set(key, value);
        return { ok: true };
      } catch (error) {
        if (error instanceof NamespacedStorageError) return { ok: false, error };
        throw error;
      }
    },

    child(segment) {
      assertValidSegment(segment, 'child segment', path);
      return createSyncStore({ ...context, segments: [...segments, segment] });
    },
  };

  return store;
}
