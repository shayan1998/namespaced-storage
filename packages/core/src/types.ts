import type { NamespacedStorageError } from './errors.js';

/** What to do when a stored value cannot be parsed. Reads never throw unless you ask them to. */
export type CorruptPolicy = 'ignore' | 'remove' | 'throw';

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
  onError?: (error: NamespacedStorageError) => void;
}

export type TrySetResult = { ok: true } | { ok: false; error: NamespacedStorageError };

export interface SyncNamespacedStore {
  /** Writing `undefined` removes the key. */
  set(key: string, value: unknown): void;
  get<T = unknown>(key: string): T | undefined;
  remove(key: string): void;
  has(key: string): boolean;
  /** Removes every key in this namespace — and only this namespace. */
  clear(): void;
  keys(): string[];
  entries(): [string, unknown][];
  readonly size: number;

  /** Aliases matching the native API, so migrating off raw storage is mechanical. */
  setItem(key: string, value: unknown): void;
  getItem<T = unknown>(key: string): T | undefined;
  removeItem(key: string): void;

  /** Like `set`, but returns the error instead of throwing it. */
  trySet(key: string, value: unknown): TrySetResult;

  /** A nested namespace: `basket.child('ui')` reads and writes `basket:ui:*`. */
  child(segment: string): SyncNamespacedStore;

  /** Full namespace path, e.g. `'myapp:basket'`. */
  readonly namespace: string;
  /** Name of the backend actually in use — `'localStorage'`, `'memory'`, `'noop'`, … */
  readonly adapter: string;
  /** `false` when the requested backend was unavailable and a fallback is in use. */
  readonly available: boolean;
}
