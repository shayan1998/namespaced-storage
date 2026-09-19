import type { SyncAdapter } from '../adapters/types.js';
import { decode, encode } from '../codec/envelope.js';
import { approximateBytes, formatBytes } from '../codec/size.js';
import {
  DecodeError,
  NamespacedStorageError,
  StorageQuotaError,
  StorageUnavailableError,
  ValidationError,
  isQuotaError,
} from '../errors.js';
import {
  assertValidKey,
  assertValidSegment,
  createKeyCodec,
  isReservedKey,
} from '../namespace/key.js';
import { type ResolvedTyping, cloneDefault, formatIssues } from '../typing/resolve.js';
import type {
  CorruptPolicy,
  InvalidPolicy,
  StoreOptions,
  SyncNamespacedStore,
  TrySetResult,
} from '../types.js';

export interface StoreContext {
  /** `[prefix?, namespace, ...children]`, already ordered. */
  segments: readonly string[];
  adapter: SyncAdapter;
  /** Whether the *requested* backend was available, as opposed to the fallback now in use. */
  available: boolean;
  options: StoreOptions;
  /** Absent for a store with no declared keys. */
  typing?: ResolvedTyping | undefined;
}

export function createSyncStore(context: StoreContext): SyncNamespacedStore {
  const { segments, adapter, available, options, typing } = context;
  const separator = options.separator;
  const codec = createKeyCodec(separator === undefined ? { segments } : { segments, separator });
  const onCorrupt: CorruptPolicy = options.onCorrupt ?? 'ignore';
  const onInvalid: InvalidPolicy = options.onInvalid ?? 'ignore';
  const path = codec.path;

  /** A throwing `onError` handler must never take the storage call down with it. */
  const report = (error: NamespacedStorageError): void => {
    try {
      options.onError?.(error);
    } catch {
      /* the handler's problem, not ours */
    }
  };

  const defaultFor = (key: string): unknown =>
    typing?.defaults.has(key) === true
      ? cloneDefault(typing.defaults.get(key), path, key)
      : undefined;

  const namespacedKeys = (): string[] => {
    const out: string[] = [];
    for (const rawKey of adapter.keys()) {
      const key = codec.decode(rawKey);
      if (key !== null && !isReservedKey(key)) out.push(key);
    }
    return out;
  };

  /** Returns the validated value, or throws ValidationError. A key with no schema passes through. */
  const validate = (key: string, value: unknown): unknown => {
    const validator = typing?.validators.get(key);
    if (!validator) return value;
    const result = validator(value);
    if (result.ok) return result.value;
    throw new ValidationError(
      `The value for "${key}" does not match its schema: ${formatIssues(result.issues)}.`,
      result.issues,
      { namespace: path, key },
    );
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
      // Writes are validated and always throw: keeping bad data out is worth more than
      // tolerating it, and a typed call site has already been checked at compile time.
      const validated = validate(key, value);
      const raw = encode(validated, path, key);
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
      if (raw === null) return defaultFor(key) as T | undefined;

      let value: unknown;
      try {
        value = decode(raw, path, key).value;
      } catch (error) {
        if (!(error instanceof DecodeError)) throw error;
        report(error);
        if (onCorrupt === 'throw') throw error;
        if (onCorrupt === 'remove') adapter.removeItem(fullKey);
        return defaultFor(key) as T | undefined;
      }

      try {
        return validate(key, value) as T;
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        report(error);
        if (onInvalid === 'throw') throw error;
        if (onInvalid === 'remove') adapter.removeItem(fullKey);
        // Data left over from an older shape falls back to the default rather than to nothing.
        return defaultFor(key) as T | undefined;
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
      // A child declares no keys of its own, so it is deliberately untyped.
      return createSyncStore({ ...context, segments: [...segments, segment], typing: undefined });
    },
  };

  return store;
}
