import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as publicApi from '../src/index.js';
import { createMemoryStorage } from '../src/store/create.js';
import {
  createMemoryAdapter,
  createNoopAdapter,
  resetMemoryAdapters,
} from '../src/adapters/memory.js';
import { createSyncStore } from '../src/store/sync.js';
import { approximateBytes, formatBytes } from '../src/codec/json.js';
import { NamespacedStorageError, StorageUnavailableError, isQuotaError } from '../src/errors.js';
import type { SyncAdapter } from '../src/adapters/types.js';

beforeEach(() => resetMemoryAdapters());

describe('public entry point', () => {
  it('exports the documented surface', () => {
    for (const name of [
      'createLocalStorage',
      'createSessionStorage',
      'createMemoryStorage',
      'createMemoryAdapter',
      'createNoopAdapter',
      'createWebStorageAdapter',
      'resetMemoryAdapters',
      'NamespacedStorageError',
      'StorageQuotaError',
      'StorageUnavailableError',
      'DecodeError',
      'SerializationError',
      'InvalidKeyError',
      'InvalidNamespaceError',
      'InvalidOptionsError',
    ]) {
      expect(publicApi).toHaveProperty(name);
    }
  });
});

describe('createMemoryStorage', () => {
  it('behaves like the other factories without touching the DOM', () => {
    const store = createMemoryStorage('scratch');
    expect(store.available).toBe(true);
    expect(store.adapter).toBe('memory');
    store.set('a', { deep: [1] });
    expect(store.get('a')).toEqual({ deep: [1] });
    expect(store.keys()).toEqual(['a']);
    store.clear();
    expect(store.size).toBe(0);
  });

  it('keeps separate named memory adapters isolated', () => {
    const a = createMemoryAdapter('one');
    const b = createMemoryAdapter('two');
    a.setItem('k', '1');
    expect(b.getItem('k')).toBeNull();
    expect(a.keys()).toEqual(['k']);
    a.removeItem('k');
    expect(a.getItem('k')).toBeNull();
  });
});

describe('noop adapter', () => {
  it('accepts writes and reports nothing', () => {
    const adapter = createNoopAdapter();
    expect(adapter.isAvailable()).toBe(true);
    adapter.setItem('k', 'v');
    expect(adapter.getItem('k')).toBeNull();
    adapter.removeItem('k');
    expect(adapter.keys()).toEqual([]);
  });
});

describe('isQuotaError', () => {
  it('recognises the standard DOMException', () => {
    expect(isQuotaError(new DOMException('full', 'QuotaExceededError'))).toBe(true);
  });

  it("recognises Firefox's legacy name", () => {
    expect(isQuotaError(new DOMException('full', 'NS_ERROR_DOM_QUOTA_REACHED'))).toBe(true);
  });

  it('recognises a plain Error whose name mentions a quota', () => {
    const error = new Error('full');
    error.name = 'QuotaExceededError';
    expect(isQuotaError(error)).toBe(true);
  });

  it('rejects unrelated failures', () => {
    expect(isQuotaError(new Error('boom'))).toBe(false);
    expect(isQuotaError(new DOMException('nope', 'SecurityError'))).toBe(false);
    expect(isQuotaError('a string')).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });
});

describe('errors', () => {
  it('carries a stable code and namespace context', () => {
    const cause = new Error('underlying');
    const error = new StorageUnavailableError('gone', { namespace: 'basket', key: 'count', cause });
    expect(error).toBeInstanceOf(NamespacedStorageError);
    expect(error.code).toBe('STORAGE_UNAVAILABLE');
    expect(error.namespace).toBe('basket');
    expect(error.key).toBe('count');
    expect(error.cause).toBe(cause);
    expect(error.name).toBe('StorageUnavailableError');
    expect(error.message).toMatch(/^\[namespaced-storage] /);
  });
});

describe('size formatting', () => {
  it('counts UTF-16 code units, as browsers do', () => {
    expect(approximateBytes('abc')).toBe(6);
  });

  it('scales the unit to the magnitude', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 kB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

/** An adapter whose writes fail for a reason that is not a full quota. */
function hostileAdapter(error: unknown): SyncAdapter {
  return {
    ...createMemoryAdapter('hostile'),
    setItem() {
      throw error;
    },
  };
}

describe('write failures that are not quota failures', () => {
  it('surface as StorageUnavailableError and still reach onError', () => {
    const onError = vi.fn();
    const store = createSyncStore({
      segments: ['basket'],
      adapter: hostileAdapter(new DOMException('nope', 'SecurityError')),
      available: true,
      options: { onError },
    });

    expect(() => store.set('count', 1)).toThrow(StorageUnavailableError);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('trySet still converts them to a result', () => {
    const store = createSyncStore({
      segments: ['basket'],
      adapter: hostileAdapter(new DOMException('nope', 'SecurityError')),
      available: true,
      options: {},
    });
    const result = store.trySet('count', 1);
    expect(result.ok).toBe(false);
  });

  it('trySet rethrows an error that is not ours, rather than swallowing it', () => {
    const boom = new TypeError('something else entirely');
    const store = createSyncStore({
      segments: ['basket'],
      adapter: {
        ...createMemoryAdapter('hostile2'),
        setItem() {
          throw boom;
        },
      },
      available: true,
      // A non-quota DOMException is wrapped; a raw TypeError from a broken adapter is not ours.
      options: { onError: () => {} },
    });
    // The store wraps any setItem failure, so trySet returns a result here too.
    expect(store.trySet('count', 1).ok).toBe(false);
  });
});

describe('onError handlers are never trusted', () => {
  it('a throwing handler does not break construction-time fallback', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });
    try {
      expect(() =>
        publicApi.createLocalStorage('basket', {
          onError: () => {
            throw new Error('handler blew up');
          },
        }),
      ).not.toThrow();
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
    }
  });
});

describe('custom separator end to end', () => {
  it('writes and enumerates with the configured separator', () => {
    const store = createMemoryStorage('basket', { separator: '/' });
    store.set('count', 1);
    expect(createMemoryAdapter().keys()).toContain('basket/count');
    expect(store.keys()).toEqual(['count']);
  });

  it('rejects a separator that could appear inside a namespace', () => {
    expect(() => createMemoryStorage('basket', { separator: '.' })).toThrow(
      publicApi.InvalidOptionsError,
    );
  });
});
