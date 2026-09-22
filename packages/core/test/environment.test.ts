import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalStorage } from '../src/store/create.js';
import { resetMemoryAdapters } from '../src/adapters/memory.js';
import { resetNamespaceRegistry } from '../src/namespace/registry.js';
import { StorageQuotaError, StorageUnavailableError } from '../src/errors.js';

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

/** Replaces `globalThis.localStorage` for one test. `define(null)` removes it entirely (SSR). */
function define(value: unknown | null, opts: { throwOnAccess?: boolean } = {}): void {
  if (opts.throwOnAccess) {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        // Exactly what a cookie-blocked iframe does: the property access itself throws.
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
    return;
  }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value,
  });
}

function quotaException(): DOMException {
  return new DOMException('exceeded the quota', 'QuotaExceededError');
}

beforeEach(() => {
  resetMemoryAdapters();
  resetNamespaceRegistry();
});

afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  resetMemoryAdapters();
});

describe('no browser environment (SSR)', () => {
  beforeEach(() => define(undefined));

  it('does not throw at construction and keeps working in memory', () => {
    const onError = vi.fn();
    const basket = createLocalStorage('basket', { onError });

    expect(basket.available).toBe(false);
    expect(basket.adapter).toBe('memory:localStorage');
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(StorageUnavailableError);

    basket.set('count', 1);
    expect(basket.get('count')).toBe(1);
  });

  it('honours fallback: throw', () => {
    expect(() => createLocalStorage('basket', { fallback: 'throw' })).toThrow(
      StorageUnavailableError,
    );
  });

  it('honours fallback: noop — writes vanish, reads are empty, nothing throws', () => {
    const basket = createLocalStorage('basket', { fallback: 'noop' });
    basket.set('count', 1);
    expect(basket.get('count')).toBeUndefined();
    expect(basket.size).toBe(0);
    expect(basket.adapter).toBe('noop');
  });

  it('shares the memory fallback between stores in the same runtime', () => {
    // Two instances of one namespace on purpose, which is exactly what strict:false is for.
    const a = createLocalStorage('basket', { strict: false });
    const b = createLocalStorage('basket', { strict: false });
    a.set('count', 7);
    expect(b.get('count')).toBe(7);
  });
});

describe('storage blocked by the embedding page', () => {
  it('survives a SecurityError raised by the property access itself', () => {
    define(null, { throwOnAccess: true });
    expect(() => globalThis.localStorage).toThrow(DOMException);

    const basket = createLocalStorage('basket');
    expect(basket.available).toBe(false);
    basket.set('count', 1);
    expect(basket.get('count')).toBe(1);
  });
});

describe('Safari private mode', () => {
  it('detects a storage whose very first write throws at zero bytes', () => {
    define({
      length: 0,
      getItem: () => null,
      setItem: () => {
        throw quotaException();
      },
      removeItem: () => {},
      key: () => null,
      clear: () => {},
    });

    const basket = createLocalStorage('basket');
    expect(basket.available).toBe(false);
    expect(basket.adapter).toBe('memory:localStorage');
    // The app keeps working rather than throwing on every write.
    basket.set('count', 1);
    expect(basket.get('count')).toBe(1);
  });
});

describe('quota exceeded on a working storage', () => {
  function fillUpAfterProbe() {
    const backing = new Map<string, string>();
    let probed = false;
    define({
      get length() {
        return backing.size;
      },
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => {
        // Let the availability probe through, then behave as a full disk.
        if (!probed) {
          probed = true;
          backing.set(k, v);
          return;
        }
        throw quotaException();
      },
      removeItem: (k: string) => void backing.delete(k),
      key: (i: number) => [...backing.keys()][i] ?? null,
      clear: () => backing.clear(),
    });
  }

  it('throws a typed StorageQuotaError carrying the namespace and key', () => {
    fillUpAfterProbe();
    const onError = vi.fn();
    const basket = createLocalStorage('basket', { onError });
    expect(basket.available).toBe(true);

    let thrown: unknown;
    try {
      basket.set('items', [1, 2, 3]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(StorageQuotaError);
    const error = thrown as StorageQuotaError;
    expect(error.code).toBe('QUOTA_EXCEEDED');
    expect(error.namespace).toBe('basket');
    expect(error.key).toBe('items');
    expect(onError).toHaveBeenCalledWith(error);
  });

  it('trySet returns the error instead of throwing', () => {
    fillUpAfterProbe();
    const basket = createLocalStorage('basket');
    const result = basket.trySet('items', [1, 2, 3]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(StorageQuotaError);
  });

  it('trySet reports success on a normal write', () => {
    const basket = createLocalStorage('basket');
    expect(basket.trySet('count', 1)).toEqual({ ok: true });
  });
});

describe('a storage that throws on every operation', () => {
  /** Passes the availability probe, then fails every operation afterwards. */
  function failAfterProbe() {
    const probeBacking = new Map<string, string>();
    let live = false;
    const guard = () => {
      if (live) throw new DOMException('insecure', 'SecurityError');
    };
    define({
      get length(): number {
        guard();
        return 0;
      },
      getItem: (k: string): string | null => {
        guard();
        return probeBacking.get(k) ?? null;
      },
      setItem: (k: string, v: string): void => {
        guard();
        probeBacking.set(k, v);
      },
      removeItem: (k: string): void => {
        if (live) throw new DOMException('insecure', 'SecurityError');
        probeBacking.delete(k);
        // The probe has completed its write/read/delete round trip; go hostile from here on.
        live = true;
      },
      key: (): string | null => {
        guard();
        return null;
      },
      clear: (): void => guard(),
    });
  }

  it('reads, deletes and enumerations degrade instead of throwing', () => {
    failAfterProbe();
    const basket = createLocalStorage('basket');
    expect(basket.available).toBe(true);

    expect(basket.get('count')).toBeUndefined();
    expect(basket.has('count')).toBe(false);
    expect(() => basket.remove('count')).not.toThrow();
    expect(basket.keys()).toEqual([]);
    expect(basket.size).toBe(0);
    expect(() => basket.clear()).not.toThrow();
  });
});
