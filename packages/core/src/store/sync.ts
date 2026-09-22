import type { SyncAdapter } from '../adapters/types.js';
import { type EnvelopeMeta, decode, encode, isExpired, peekMeta } from '../codec/envelope.js';
import { approximateBytes, formatBytes } from '../codec/size.js';
import {
  DecodeError,
  InvalidOptionsError,
  NamespacedStorageError,
  StorageQuotaError,
  StorageUnavailableError,
  SubscriberError,
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
  ChangeEvent,
  CorruptPolicy,
  EntryMeta,
  InvalidPolicy,
  SetOptions,
  StoreOptions,
  SyncNamespacedStore,
  TrySetResult,
  Unsubscribe,
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
  const timestamps = options.timestamps ?? false;
  const path = codec.path;

  if (options.ttl !== undefined) assertValidTtl(options.ttl, path);

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
    const now = Date.now();
    const out: string[] = [];
    for (const rawKey of adapter.keys()) {
      const key = codec.decode(rawKey);
      if (key === null || isReservedKey(key)) continue;
      // Expired keys are hidden here but not deleted: enumerating should not write.
      // `get` and `has` do the collecting.
      const raw = adapter.getItem(rawKey);
      if (raw !== null && isExpired(peekMeta(raw), now)) continue;
      out.push(key);
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

  /** Reads the stored metadata for a key, dropping the entry if its lifetime has run out. */
  const readMeta = (key: string, now: number): EnvelopeMeta | undefined => {
    const fullKey = codec.encode(key);
    const raw = adapter.getItem(fullKey);
    if (raw === null) return undefined;
    const meta = peekMeta(raw);
    if (isExpired(meta, now)) {
      // Lazy cleanup: nothing else will ever come along to collect it.
      adapter.removeItem(fullKey);
      return undefined;
    }
    return meta;
  };

  /**
   * Turns a raw stored string into a value for a change event. Unlike `get` it never throws and
   * never applies a default: an event reports what happened, and a listener running inside the
   * browser's event loop must not be able to take the page down.
   */
  const valueFromRaw = (key: string, raw: string | null): unknown => {
    if (raw === null) return undefined;
    try {
      return validate(key, decode(raw, path, key).value);
    } catch (error) {
      if (error instanceof NamespacedStorageError) report(error);
      return undefined;
    }
  };

  const store: SyncNamespacedStore = {
    namespace: path,
    adapter: adapter.name,
    available,

    set(key, value, setOptions) {
      assertValidKey(key, path);
      if (value === undefined) {
        store.remove(key);
        return;
      }
      // Writes are validated and always throw: keeping bad data out is worth more than
      // tolerating it, and a typed call site has already been checked at compile time.
      const validated = validate(key, value);
      const raw = encode(validated, path, key, buildMeta(key, setOptions));
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

      if (isExpired(peekMeta(raw), Date.now())) {
        adapter.removeItem(fullKey);
        return defaultFor(key) as T | undefined;
      }

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
      const raw = adapter.getItem(codec.encode(key));
      if (raw === null) return false;
      if (isExpired(peekMeta(raw), Date.now())) {
        adapter.removeItem(codec.encode(key));
        return false;
      }
      return true;
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

    setItem: (key, value, setOptions) => store.set(key, value, setOptions),
    getItem: <T>(key: string) => store.get<T>(key),
    removeItem: (key) => store.remove(key),

    meta(key) {
      assertValidKey(key, path);
      const stored = readMeta(key, Date.now());
      if (stored === undefined) return undefined;
      const out: EntryMeta = {};
      if (stored.c !== undefined) out.createdAt = stored.c;
      if (stored.u !== undefined) out.updatedAt = stored.u;
      if (stored.e !== undefined) out.expiresAt = stored.e;
      return out;
    },

    ttl(key) {
      assertValidKey(key, path);
      const now = Date.now();
      const stored = readMeta(key, now);
      return stored?.e === undefined ? null : stored.e - now;
    },

    trySet(key, value, setOptions): TrySetResult {
      try {
        store.set(key, value, setOptions);
        return { ok: true };
      } catch (error) {
        if (error instanceof NamespacedStorageError) return { ok: false, error };
        throw error;
      }
    },

    subscribe(
      keyOrListener: string | ((event: ChangeEvent) => void),
      maybeListener?: (event: ChangeEvent) => void,
    ): Unsubscribe {
      const watchedKey = typeof keyOrListener === 'string' ? keyOrListener : undefined;
      const listener = (typeof keyOrListener === 'string' ? maybeListener : keyOrListener) as
        ((event: ChangeEvent) => void) | undefined;
      if (listener === undefined) return () => {};
      if (watchedKey !== undefined) assertValidKey(watchedKey, path);
      // `noop`, and any future adapter that cannot observe, simply never fires.
      if (adapter.subscribe === undefined) return () => {};

      const deliver = (event: ChangeEvent): void => {
        try {
          listener(event);
        } catch (cause) {
          // A throwing subscriber must not take down the others, nor the storage event itself.
          report(
            new SubscriberError(
              `A subscriber for "${event.key ?? '*'}" threw. The other subscribers are unaffected.`,
              { namespace: path, cause, ...(event.key === null ? {} : { key: event.key }) },
            ),
          );
        }
      };

      return adapter.subscribe((change) => {
        if (change.key === null) {
          // Another tab cleared the whole area. A per-key subscriber is told about its own key
          // rather than handed a null it would have to interpret.
          deliver(
            watchedKey === undefined
              ? { key: null, newValue: undefined, oldValue: undefined, source: change.source }
              : {
                  key: watchedKey,
                  newValue: undefined,
                  oldValue: undefined,
                  source: change.source,
                },
          );
          return;
        }

        const key = codec.decode(change.key);
        if (key === null || isReservedKey(key)) return;
        if (watchedKey !== undefined && key !== watchedKey) return;

        deliver({
          key,
          newValue: valueFromRaw(key, change.newValue),
          oldValue: valueFromRaw(key, change.oldValue),
          source: change.source,
        });
      });
    },

    child(segment) {
      assertValidSegment(segment, 'child segment', path);
      // A child declares no keys of its own, so it is deliberately untyped.
      return createSyncStore({ ...context, segments: [...segments, segment], typing: undefined });
    },
  };

  /** Assembles the envelope metadata a write should carry, or nothing when it needs none. */
  function buildMeta(key: string, setOptions: SetOptions | undefined): EnvelopeMeta | undefined {
    const ttl = setOptions?.ttl ?? options.ttl;
    if (ttl !== undefined) assertValidTtl(ttl, path, key);
    if (!timestamps && ttl === undefined) return undefined;

    const now = Date.now();
    const meta: EnvelopeMeta = {};
    if (timestamps) {
      // An update keeps its original createdAt, which costs one extra read — only when asked for.
      meta.c = readMeta(key, now)?.c ?? now;
      meta.u = now;
    }
    if (ttl !== undefined) meta.e = now + ttl;
    return meta;
  }

  return store;
}

function assertValidTtl(ttl: number, namespace: string, key?: string): void {
  if (typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl <= 0) {
    throw new InvalidOptionsError(
      `ttl must be a positive, finite number of milliseconds, received ${JSON.stringify(ttl)}.`,
      key === undefined ? { namespace } : { namespace, key },
    );
  }
}
