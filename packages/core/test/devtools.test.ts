import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMemoryAdapters } from '../src/adapters/memory.js';
import type { Devtools } from '../src/features/inspect.js';
import { resetNamespaceRegistry } from '../src/namespace/registry.js';
import { createLocalStorage, createMemoryStorage, createSessionStorage } from '../src/full.js';

const host = globalThis as Record<string, unknown>;

beforeEach(() => {
  resetNamespaceRegistry();
  resetMemoryAdapters();
  localStorage.clear();
  sessionStorage.clear();
  delete host.__NAMESPACED_STORAGE__;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'table').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  delete host.__NAMESPACED_STORAGE__;
});

/** Pretends the bundle is running in a production build. */
function asProduction(run: () => void): void {
  const process = globalThis as { process?: { env?: Record<string, string | undefined> } };
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'process');
  const original = process.process;
  Object.defineProperty(globalThis, 'process', {
    configurable: true,
    value: { env: { NODE_ENV: 'production' } },
  });
  try {
    run();
  } finally {
    if (had) Object.defineProperty(globalThis, 'process', { configurable: true, value: original });
    else delete process.process;
  }
}

const devtools = (): Devtools => host.__NAMESPACED_STORAGE__ as Devtools;
const summary = (): string => vi.mocked(console.log).mock.calls[0]?.[0] as string;
const table = (): Record<string, { value: unknown; type: string; size: string; expires: string }> =>
  vi.mocked(console.table).mock.calls[0]?.[0] as never;

describe('export()', () => {
  it('returns a plain snapshot of what is stored', () => {
    const basket = createLocalStorage('basket');
    basket.set('count', 10);
    basket.set('items', [{ id: 'sku-1' }]);

    expect(basket.export()).toEqual({ count: 10, items: [{ id: 'sku-1' }] });
  });

  it('returns values as `get` returns them, decoded', () => {
    const basket = createLocalStorage('basket');
    basket.set('lastOpened', new Date('2026-01-01T00:00:00.000Z'));

    const exported = basket.export();
    expect(exported.lastOpened).toBeInstanceOf(Date);
  });

  it('leaves out a key that has only a default and was never written', () => {
    const basket = createLocalStorage('basket', { defaults: { count: 0, items: [] } });
    basket.set('count', 3);

    expect(basket.export()).toEqual({ count: 3 });
  });

  it('leaves out reserved and expired keys', () => {
    vi.useFakeTimers();
    const basket = createLocalStorage('basket', { version: 2 });
    basket.set('count', 1);
    basket.set('token', 'jwt', { ttl: 1000 });

    vi.advanceTimersByTime(2000);
    expect(basket.export()).toEqual({ count: 1 });
    vi.useRealTimers();
  });

  it('is empty for an empty namespace', () => {
    expect(createLocalStorage('basket').export()).toEqual({});
  });
});

describe('inspect()', () => {
  it('names the namespace, its backend, its keys and its size', () => {
    const basket = createLocalStorage('basket');
    basket.set('count', 10);
    basket.set('items', [1, 2]);
    basket.inspect();

    expect(summary()).toBe('namespaced-storage · basket (localStorage) · 2 keys · 14 B');
  });

  it('says "key" when there is one, and reports an empty namespace', () => {
    const basket = createLocalStorage('basket');
    basket.set('count', 10);
    basket.inspect();
    expect(summary()).toContain('1 key ·');

    vi.mocked(console.log).mockClear();
    createLocalStorage('other').inspect();
    expect(summary()).toContain('0 keys · 0 B');
  });

  it('says so when the store fell back to memory', () => {
    const store = createMemoryStorage('basket');
    store.inspect();
    expect(summary()).toContain('(memory)');
    expect(summary()).not.toContain('unavailable');
  });

  it('says so when the requested backend was not available', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });

    createLocalStorage('basket').inspect();
    expect(summary()).toContain('storage unavailable, using a fallback');

    if (original) Object.defineProperty(globalThis, 'localStorage', original);
  });

  it('hands one row per key to console.table', () => {
    const basket = createLocalStorage('basket');
    basket.set('count', 10);
    basket.set('items', [{ id: 'sku-1' }]);
    basket.inspect();

    expect(Object.keys(table())).toEqual(['count', 'items']);
    expect(table().count?.value).toBe(10);
    expect(table().count?.size).toBe('4 B');
  });

  it('names types the way the codecs do', () => {
    const store = createMemoryStorage('s');
    store.set('n', 1);
    store.set('s', 'x');
    store.set('b', true);
    store.set('arr', [1]);
    store.set('date', new Date());
    store.set('map', new Map([['a', 1]]));
    store.set('obj', { a: 1 });
    store.set('nil', null);
    store.inspect();

    const types = Object.fromEntries(Object.entries(table()).map(([key, row]) => [key, row.type]));
    expect(types).toEqual({
      n: 'number',
      s: 'string',
      b: 'boolean',
      arr: 'array',
      date: 'date',
      map: 'map',
      obj: 'object',
      nil: 'null',
    });
  });

  it('shows the time left on a key that expires, and a dash on one that does not', () => {
    vi.useFakeTimers();
    const store = createMemoryStorage('s');
    store.set('forever', 1);
    store.set('seconds', 1, { ttl: 30_000 });
    store.set('minutes', 1, { ttl: 5 * 60_000 });
    store.set('hours', 1, { ttl: 3 * 3_600_000 });
    store.inspect();

    expect(table().forever?.expires).toBe('—');
    expect(table().seconds?.expires).toBe('30s');
    expect(table().minutes?.expires).toBe('5m');
    expect(table().hours?.expires).toBe('3h');
    vi.useRealTimers();
  });

  it('works on a child namespace', () => {
    const ui = createLocalStorage('basket').child('ui');
    ui.set('collapsed', true);
    ui.inspect();

    expect(summary()).toContain('basket:ui');
    expect(Object.keys(table())).toEqual(['collapsed']);
  });

  it('ships in production, because that is where it is worth most', () => {
    asProduction(() => {
      const basket = createLocalStorage('basket');
      basket.set('count', 1);
      basket.inspect();
    });

    expect(console.table).toHaveBeenCalledTimes(1);
  });
});

describe('the development global', () => {
  it('collects every store constructed on the page', () => {
    const basket = createLocalStorage('basket');
    const auth = createSessionStorage('auth');

    expect(devtools().stores).toEqual({ basket, auth });
  });

  it('inspects all of them at once', () => {
    createLocalStorage('basket').set('count', 1);
    createSessionStorage('auth').set('token', 'x');

    devtools().inspect();

    expect(console.table).toHaveBeenCalledTimes(2);
  });

  it('survives being destructured in a console', () => {
    createLocalStorage('basket');
    const { inspect } = devtools();

    expect(() => inspect()).not.toThrow();
  });

  it('qualifies a namespace held by two different backends', () => {
    const local = createLocalStorage('auth');
    const session = createSessionStorage('auth');

    expect(devtools().stores.auth).toBe(local);
    expect(devtools().stores['auth@sessionStorage']).toBe(session);
  });

  it('lets a hot reload take its own place back', () => {
    createLocalStorage('basket', { strict: false });
    const second = createLocalStorage('basket', { strict: false });

    expect(Object.keys(devtools().stores)).toEqual(['basket']);
    expect(devtools().stores.basket).toBe(second);
  });

  it('does not register a child namespace', () => {
    createLocalStorage('basket').child('ui');

    expect(Object.keys(devtools().stores)).toEqual(['basket']);
  });

  it('gives up quietly when the page will not let it write a global', () => {
    Object.defineProperty(globalThis, '__NAMESPACED_STORAGE__', {
      configurable: true,
      get() {
        throw new Error('locked down');
      },
    });

    expect(() => createLocalStorage('basket')).not.toThrow();
    delete host.__NAMESPACED_STORAGE__;
  });

  it('is absent in production', () => {
    asProduction(() => {
      createLocalStorage('basket');
      expect(host.__NAMESPACED_STORAGE__).toBeUndefined();
    });
  });
});
