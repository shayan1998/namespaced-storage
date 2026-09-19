import type { NamespacedStorageError } from './errors.js';

/** What to do when a stored value cannot be parsed. Reads never throw unless you ask them to. */
export type CorruptPolicy = 'ignore' | 'remove' | 'throw';

/** What to do when a stored value fails its schema — usually data from an older shape. */
export type InvalidPolicy = 'ignore' | 'remove' | 'throw';

/** What to do when the requested storage backend is unavailable (SSR, private mode, blocked). */
export type FallbackPolicy = 'memory' | 'throw' | 'noop';

export interface StoreOptions {
  /** Default `'memory'` — the app keeps working when storage is missing or blocked. */
  fallback?: FallbackPolicy;
  /** Default `':'`. Must not be made of characters that are legal inside a namespace. */
  separator?: string;
  /** Optional application-wide prefix, e.g. `'myapp'` → `myapp:basket:count`. */
  prefix?: string;
  /** Owning team. Not used at runtime; read by `nss scan` to build the inventory. */
  owner?: string;
  /** What this namespace is for. Not used at runtime; read by `nss scan`. */
  description?: string;
  /** Default `'ignore'` — a corrupt value reads as `undefined` and reports via `onError`. */
  onCorrupt?: CorruptPolicy;
  /** Default `'ignore'` — a value failing its schema reads as its default, or `undefined`. */
  onInvalid?: InvalidPolicy;
  onError?: (error: NamespacedStorageError) => void;
}

/** Declares the keys a store holds. See `defaults` and `schema` in the README. */
export interface TypedStoreOptions<
  D extends Record<string, unknown> = Record<never, never>,
  S extends Record<string, unknown> = Record<never, never>,
> extends StoreOptions {
  /** Fallback values. Their types become the key types; a clone is returned on every read. */
  defaults?: D;
  /** `t.*` or any Standard Schema validator. Validates on write, and on read per `onInvalid`. */
  schema?: S;
}

export type TrySetResult = { ok: true } | { ok: false; error: NamespacedStorageError };

interface StoreIdentity {
  /** Full namespace path, e.g. `'myapp:basket'`. */
  readonly namespace: string;
  /** Name of the backend actually in use — `'localStorage'`, `'memory'`, `'noop'`, … */
  readonly adapter: string;
  /** `false` when the requested backend was unavailable and a fallback is in use. */
  readonly available: boolean;
}

interface StoreCommon<K extends string> extends StoreIdentity {
  remove(key: K): void;
  has(key: K): boolean;
  /** Removes every key in this namespace — and only this namespace. */
  clear(): void;
  /**
   * The keys currently present in storage, namespace-relative. A key that has a default but has
   * never been written is absent here, even though `get` returns its default.
   */
  keys(): K[];
  readonly size: number;
  /** A nested namespace: `basket.child('ui')` reads and writes `basket:ui:*`. It is untyped. */
  child(segment: string): SyncNamespacedStore;
  removeItem(key: K): void;
}

/** A store with no declared keys: any string key, values typed by the caller. */
export interface SyncNamespacedStore extends StoreCommon<string> {
  /** Writing `undefined` removes the key. */
  set(key: string, value: unknown): void;
  get<T = unknown>(key: string): T | undefined;
  entries(): [string, unknown][];
  setItem(key: string, value: unknown): void;
  getItem<T = unknown>(key: string): T | undefined;
  /** Like `set`, but returns the error instead of throwing it. */
  trySet(key: string, value: unknown): TrySetResult;
}

/**
 * A store whose keys and value types are known.
 *
 * `V` maps each key to its value type; `D` is the subset of keys that have a default and
 * therefore never read back as `undefined`.
 */
export interface TypedSyncNamespacedStore<
  V extends Record<string, unknown>,
  D extends keyof V = never,
> extends StoreCommon<keyof V & string> {
  set<K extends keyof V & string>(key: K, value: V[K]): void;
  get<K extends keyof V & string>(key: K): K extends D ? V[K] : V[K] | undefined;
  entries(): { [K in keyof V & string]: [K, V[K]] }[keyof V & string][];
  setItem<K extends keyof V & string>(key: K, value: V[K]): void;
  getItem<K extends keyof V & string>(key: K): K extends D ? V[K] : V[K] | undefined;
  trySet<K extends keyof V & string>(key: K, value: V[K]): TrySetResult;
}
