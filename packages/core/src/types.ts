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
  /** Record `createdAt` / `updatedAt` on every key. Off by default: it costs bytes and a read. */
  timestamps?: boolean;
  /** Default lifetime in ms for every key in this namespace. A per-call `ttl` overrides it. */
  ttl?: number;
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

export interface SetOptions {
  /** Lifetime in ms from now. Overrides the namespace default. Must be finite and positive. */
  ttl?: number;
}

/** Timestamps and expiry recorded alongside a value. Present only for keys that carry them. */
export interface EntryMeta {
  createdAt?: number;
  updatedAt?: number;
  expiresAt?: number;
}

export type TrySetResult = { ok: true } | { ok: false; error: NamespacedStorageError };

export type Unsubscribe = () => void;

export interface ChangeEvent<T = unknown> {
  /**
   * The namespace-relative key, or `null` when another tab cleared the whole storage area.
   * A per-key subscriber never sees `null`; it is told about its own key instead.
   */
  key: string | null;
  /** `undefined` when the key was removed. Defaults are not applied to an event. */
  newValue: T | undefined;
  /** The previous value. Never persisted — it is free here and only here (ADR-004). */
  oldValue: T | undefined;
  /** `'remote'` means another tab made the change. */
  source: 'local' | 'remote';
}

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
  /** Timestamps and expiry for a key, or `undefined` when it carries none. */
  meta(key: K): EntryMeta | undefined;
  /** Milliseconds until the key expires, or `null` when it has no expiry or is already gone. */
  ttl(key: K): number | null;
  /** A nested namespace: `basket.child('ui')` reads and writes `basket:ui:*`. It is untyped. */
  child(segment: string): SyncNamespacedStore;
  removeItem(key: K): void;
}

/** A store with no declared keys: any string key, values typed by the caller. */
export interface SyncNamespacedStore extends StoreCommon<string> {
  /** Writing `undefined` removes the key. */
  set(key: string, value: unknown, options?: SetOptions): void;
  get<T = unknown>(key: string): T | undefined;
  entries(): [string, unknown][];
  setItem(key: string, value: unknown, options?: SetOptions): void;
  getItem<T = unknown>(key: string): T | undefined;
  /** Like `set`, but returns the error instead of throwing it. */
  trySet(key: string, value: unknown, options?: SetOptions): TrySetResult;
  /** Watch one key, in this tab and in others. */
  subscribe<T = unknown>(key: string, listener: (event: ChangeEvent<T>) => void): Unsubscribe;
  /** Watch every key in the namespace. */
  subscribe(listener: (event: ChangeEvent) => void): Unsubscribe;
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
  set<K extends keyof V & string>(key: K, value: V[K], options?: SetOptions): void;
  get<K extends keyof V & string>(key: K): K extends D ? V[K] : V[K] | undefined;
  entries(): { [K in keyof V & string]: [K, V[K]] }[keyof V & string][];
  setItem<K extends keyof V & string>(key: K, value: V[K], options?: SetOptions): void;
  getItem<K extends keyof V & string>(key: K): K extends D ? V[K] : V[K] | undefined;
  trySet<K extends keyof V & string>(key: K, value: V[K], options?: SetOptions): TrySetResult;
  /** Watch one key, in this tab and in others. */
  subscribe<K extends keyof V & string>(
    key: K,
    listener: (event: ChangeEvent<V[K]>) => void,
  ): Unsubscribe;
  /** Watch every key in the namespace. */
  subscribe(listener: (event: ChangeEvent<V[keyof V & string]>) => void): Unsubscribe;
}
