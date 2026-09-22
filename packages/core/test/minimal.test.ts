import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMemoryAdapters } from '../src/adapters/memory.js';
import { InvalidOptionsError, NamespaceConflictError } from '../src/errors.js';
import { createLocalStorage, createMemoryStorage, createSessionStorage } from '../src/minimal.js';
import { resetNamespaceRegistry } from '../src/namespace/registry.js';

const host = globalThis as Record<string, unknown>;

beforeEach(() => {
  resetNamespaceRegistry();
  resetMemoryAdapters();
  localStorage.clear();
  sessionStorage.clear();
  delete host.__NAMESPACED_STORAGE__;
});

describe('level 1, and all of it', () => {
  it('namespaces reads and writes', () => {
    const basket = createLocalStorage('basket');
    basket.set('count', 10);

    expect(localStorage.getItem('basket:count')).toBe('10');
    expect(basket.get('count')).toBe(10);
  });

  it('clears its own namespace and nothing else', () => {
    localStorage.setItem('someone-else', 'keep me');
    const basket = createLocalStorage('basket');
    basket.set('count', 1);

    basket.clear();

    expect(basket.size).toBe(0);
    expect(localStorage.getItem('someone-else')).toBe('keep me');
  });

  it('round-trips the types JSON cannot represent', () => {
    const store = createMemoryStorage('s');
    store.set('state', { at: new Date('2026-01-01T00:00:00.000Z'), tags: new Set(['a']) });

    const state = store.get<{ at: Date; tags: Set<string> }>('state');
    expect(state?.at).toBeInstanceOf(Date);
    expect(state?.tags).toBeInstanceOf(Set);
  });

  it('still expires keys, times them and reports their size', () => {
    vi.useFakeTimers();
    const store = createMemoryStorage('s', { timestamps: true });
    store.set('token', 'jwt', { ttl: 1000 });

    expect(store.meta('token')?.createdAt).toBeTypeOf('number');
    expect(store.ttl('token')).toBe(1000);

    vi.advanceTimersByTime(1001);
    expect(store.get('token')).toBeUndefined();
    vi.useRealTimers();
  });

  it('still notifies subscribers', () => {
    const store = createMemoryStorage('s');
    const seen = vi.fn();
    store.subscribe('count', seen);

    store.set('count', 1);

    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('still catches a namespace claimed twice', () => {
    createLocalStorage('basket');
    expect(() => createLocalStorage('basket')).toThrow(NamespaceConflictError);
  });

  it('still inspects and exports, because that is the level 1 question', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const table = vi.spyOn(console, 'table').mockImplementation(() => {});

    const basket = createLocalStorage('basket');
    basket.set('count', 1);
    basket.inspect();

    expect(log.mock.calls[0]?.[0]).toContain('basket (localStorage)');
    expect(basket.export()).toEqual({ count: 1 });
    vi.restoreAllMocks();
    table.mockRestore();
  });

  it('offers all three backends', () => {
    expect(createLocalStorage('a').adapter).toBe('localStorage');
    expect(createSessionStorage('b').adapter).toBe('sessionStorage');
    expect(createMemoryStorage('c').adapter).toBe('memory');
  });
});

describe('what it refuses rather than ignores', () => {
  it.each(['defaults', 'schema', 'version', 'migrate'])('rejects %s by name', (option) => {
    expect(() =>
      createLocalStorage('basket', { [option]: option === 'migrate' ? () => ({}) : 2 } as never),
    ).toThrow(InvalidOptionsError);
  });

  it('names the entry point that does support it', () => {
    expect(() => createLocalStorage('basket', { version: 2 } as never)).toThrow(
      /import the factories from "namespaced-storage"/i,
    );
  });

  it('refuses before it writes anything', () => {
    expect(() => createLocalStorage('basket', { version: 2, migrate: (p: unknown) => p } as never)).toThrow(
      InvalidOptionsError,
    );

    expect(localStorage.length).toBe(0);
    // The failed construction must not have claimed the namespace either.
    expect(() => createLocalStorage('basket')).not.toThrow();
  });

  it('leaves an undefined option alone, so spreading an options object still works', () => {
    expect(() => createLocalStorage('basket', { version: undefined } as never)).not.toThrow();
  });
});

describe('what it leaves out', () => {
  it('does not register the development global', () => {
    createLocalStorage('basket');
    expect(host.__NAMESPACED_STORAGE__).toBeUndefined();
  });
});
