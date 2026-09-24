// @vitest-environment node
//
// The rest of the suite runs in happy-dom and simulates a missing `localStorage` by deleting it.
// This file runs where `window` genuinely never existed, which is what a server render is.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMemoryAdapters } from '../src/adapters/memory.js';
import { createLocalStorage, createSessionStorage } from '../src/full.js';
import { createLocalStorage as createMinimalStorage } from '../src/minimal.js';
import { resetNamespaceRegistry } from '../src/namespace/registry.js';
import { t } from '../src/typing/t.js';

beforeEach(() => {
  resetNamespaceRegistry();
  resetMemoryAdapters();
});

describe('a runtime with no browser at all', () => {
  it('has no localStorage to find, which is the point of this file', () => {
    expect('localStorage' in globalThis).toBe(false);
    expect('window' in globalThis).toBe(false);
  });

  it('constructs without throwing and says it fell back', () => {
    const onError = vi.fn();
    const basket = createLocalStorage('basket', { onError, defaults: { count: 0 } });

    expect(basket.available).toBe(false);
    expect(basket.adapter).toBe('memory:localStorage');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]?.code).toBe('STORAGE_UNAVAILABLE');
  });

  it('reads defaults and writes to memory rather than failing', () => {
    const basket = createLocalStorage('basket', { defaults: { count: 0 } });

    expect(basket.get('count')).toBe(0);
    basket.set('count', 7);
    expect(basket.get('count')).toBe(7);
    expect(basket.keys()).toEqual(['count']);
  });

  it('keeps every codec working, because the values never touched the browser', () => {
    const store = createLocalStorage('s');
    store.set('state', { at: new Date('2026-01-01T00:00:00.000Z'), ids: new Set(['a']) });

    const state = store.get<{ at: Date; ids: Set<string> }>('state');
    expect(state?.at).toBeInstanceOf(Date);
    expect(state?.ids).toBeInstanceOf(Set);
  });

  it('validates, expires, migrates and inspects, all on the fallback', () => {
    vi.useFakeTimers();
    const store = createSessionStorage('auth', {
      schema: { token: t.string() },
      ttl: 1000,
      version: 2,
      migrate: (previous) => previous,
    });

    expect(() => store.set('token', 42 as never)).toThrow();
    store.set('token', 'jwt');
    vi.advanceTimersByTime(1001);
    expect(store.get('token')).toBeUndefined();

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const table = vi.spyOn(console, 'table').mockImplementation(() => {});
    store.inspect();
    expect(log).toHaveBeenCalled();

    vi.restoreAllMocks();
    table.mockRestore();
    vi.useRealTimers();
  });

  it('subscribes without a window to listen to', () => {
    const store = createLocalStorage('s');
    const seen = vi.fn();
    const stop = store.subscribe('count', seen);

    store.set('count', 1);

    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0]?.[0]?.source).toBe('local');
    stop();
  });

  it('holds for the minimal entry point too', () => {
    const store = createMinimalStorage('basket');
    store.set('count', 1);

    expect(store.available).toBe(false);
    expect(store.get('count')).toBe(1);
  });

  it('still builds the devtools directory, because a dev server is a development environment', () => {
    createLocalStorage('basket');

    // Harmless here: the stores it references are module-scoped singletons that were alive
    // anyway, and the browser-console argument for keeping it out of production is unchanged.
    expect('__NAMESPACED_STORAGE__' in globalThis).toBe(true);
  });
});
