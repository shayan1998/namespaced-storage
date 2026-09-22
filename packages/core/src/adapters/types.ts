/**
 * A raw, un-namespaced change observed by an adapter. `key: null` means the whole storage area
 * was cleared elsewhere, which is what the native `storage` event reports for a foreign `clear()`.
 */
export interface RawChange {
  key: string | null;
  newValue: string | null;
  oldValue: string | null;
  /** `'remote'` means another tab did it. The native event never fires in the writing tab. */
  source: 'local' | 'remote';
}

export interface SyncAdapter {
  readonly kind: 'sync';
  readonly name: string;
  /** Must never throw — property access on `window.localStorage` alone can raise SecurityError. */
  isAvailable(): boolean;
  getItem(key: string): string | null;
  /** May throw; the store layer classifies quota failures. */
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /** Every raw key currently held by the backend. */
  keys(): string[];
  subscribe?(listener: (change: RawChange) => void): () => void;
}

/**
 * Declared in 1.0 but not implemented until 2.0. It exists now so that the sync/async split is
 * visible in the type system from the start and adding Redis later needs no redesign (ADR-006).
 */
export interface AsyncAdapter {
  readonly kind: 'async';
  readonly name: string;
  isAvailable(): Promise<boolean>;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  keys(): Promise<string[]>;
  subscribe?(listener: (change: RawChange) => void): () => void;
}

export type Adapter = SyncAdapter | AsyncAdapter;
