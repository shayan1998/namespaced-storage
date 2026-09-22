import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalStorage, createMemoryStorage } from '../src/full.js';
import { resetMemoryAdapters } from '../src/adapters/memory.js';
import { resetNamespaceRegistry } from '../src/namespace/registry.js';
import { InvalidOptionsError } from '../src/errors.js';
import { t } from '../src/typing/t.js';

beforeEach(() => {
  resetNamespaceRegistry();
  localStorage.clear();
  resetMemoryAdapters();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-22T10:00:00.000Z'));
});

afterEach(() => vi.useRealTimers());

const MINUTE = 60_000;

describe('expiry', () => {
  it('reads normally before the deadline and is gone after it', () => {
    const auth = createLocalStorage('auth');
    auth.set('token', 'jwt', { ttl: 15 * MINUTE });

    vi.advanceTimersByTime(14 * MINUTE);
    expect(auth.get('token')).toBe('jwt');
    expect(auth.has('token')).toBe(true);

    vi.advanceTimersByTime(2 * MINUTE);
    expect(auth.get('token')).toBeUndefined();
    expect(auth.has('token')).toBe(false);
  });

  it('expires exactly at the deadline, not a tick later', () => {
    const auth = createMemoryStorage('auth');
    auth.set('token', 'jwt', { ttl: 1000 });
    vi.advanceTimersByTime(999);
    expect(auth.get('token')).toBe('jwt');
    vi.advanceTimersByTime(1);
    expect(auth.get('token')).toBeUndefined();
  });

  it('collects the dead entry rather than leaving it to rot', () => {
    const auth = createLocalStorage('auth');
    auth.set('token', 'jwt', { ttl: MINUTE });
    vi.advanceTimersByTime(2 * MINUTE);

    expect(localStorage.getItem('auth:token')).not.toBeNull();
    auth.get('token');
    expect(localStorage.getItem('auth:token')).toBeNull();
  });

  it('is collected by has() too', () => {
    const auth = createLocalStorage('auth');
    auth.set('token', 'jwt', { ttl: MINUTE });
    vi.advanceTimersByTime(2 * MINUTE);
    expect(auth.has('token')).toBe(false);
    expect(localStorage.getItem('auth:token')).toBeNull();
  });

  it('applies a namespace-wide default lifetime', () => {
    const auth = createMemoryStorage('auth', { ttl: 5 * MINUTE });
    auth.set('token', 'jwt');
    vi.advanceTimersByTime(6 * MINUTE);
    expect(auth.get('token')).toBeUndefined();
  });

  it('lets a per-call ttl override the namespace default', () => {
    const auth = createMemoryStorage('auth', { ttl: 5 * MINUTE });
    auth.set('short', 'a', { ttl: MINUTE });
    auth.set('long', 'b', { ttl: 60 * MINUTE });

    vi.advanceTimersByTime(2 * MINUTE);
    expect(auth.get('short')).toBeUndefined();
    expect(auth.get('long')).toBe('b');
  });

  it('falls back to the default value once a key has expired', () => {
    const store = createMemoryStorage('s', { defaults: { count: 0 }, ttl: MINUTE });
    store.set('count', 42);
    expect(store.get('count')).toBe(42);
    vi.advanceTimersByTime(2 * MINUTE);
    expect(store.get('count')).toBe(0);
  });

  it('hides expired keys from keys(), size and entries(), without writing', () => {
    const store = createLocalStorage('s');
    store.set('alive', 1);
    store.set('doomed', 2, { ttl: MINUTE });

    expect(store.keys().sort()).toEqual(['alive', 'doomed']);
    vi.advanceTimersByTime(2 * MINUTE);

    expect(store.keys()).toEqual(['alive']);
    expect(store.size).toBe(1);
    expect(store.entries()).toEqual([['alive', 1]]);
    // Enumerating is a read; it must not delete anything.
    expect(localStorage.getItem('s:doomed')).not.toBeNull();
  });

  it('refreshes the deadline when the key is written again', () => {
    const auth = createMemoryStorage('auth');
    auth.set('token', 'a', { ttl: 2 * MINUTE });
    vi.advanceTimersByTime(MINUTE);
    auth.set('token', 'b', { ttl: 2 * MINUTE });
    vi.advanceTimersByTime(90_000);
    expect(auth.get('token')).toBe('b');
  });

  it('drops the expiry when the key is rewritten without one', () => {
    const auth = createMemoryStorage('auth');
    auth.set('token', 'a', { ttl: MINUTE });
    auth.set('token', 'b');
    vi.advanceTimersByTime(10 * MINUTE);
    expect(auth.get('token')).toBe('b');
    expect(auth.ttl('token')).toBeNull();
  });
});

describe('ttl()', () => {
  it('reports the time remaining', () => {
    const auth = createMemoryStorage('auth');
    auth.set('token', 'jwt', { ttl: 15 * MINUTE });
    vi.advanceTimersByTime(MINUTE);
    expect(auth.ttl('token')).toBe(14 * MINUTE);
  });

  it('is null for a key with no expiry, and for one that is absent', () => {
    const auth = createMemoryStorage('auth');
    auth.set('plain', 'x');
    expect(auth.ttl('plain')).toBeNull();
    expect(auth.ttl('missing')).toBeNull();
  });

  it('is null once the key has expired', () => {
    const auth = createMemoryStorage('auth');
    auth.set('token', 'jwt', { ttl: MINUTE });
    vi.advanceTimersByTime(2 * MINUTE);
    expect(auth.ttl('token')).toBeNull();
  });
});

describe('timestamps', () => {
  it('are off by default, so the plain shape is preserved', () => {
    const store = createLocalStorage('s');
    store.set('count', 1);
    expect(localStorage.getItem('s:count')).toBe('1');
    expect(store.meta('count')).toBeUndefined();
  });

  it('record when a key was created and last written', () => {
    const store = createMemoryStorage('s', { timestamps: true });
    const created = Date.now();
    store.set('count', 1);

    expect(store.meta('count')).toEqual({ createdAt: created, updatedAt: created });

    vi.advanceTimersByTime(MINUTE);
    store.set('count', 2);
    expect(store.meta('count')).toEqual({ createdAt: created, updatedAt: created + MINUTE });
  });

  it('start over when the key is removed and written again', () => {
    const store = createMemoryStorage('s', { timestamps: true });
    store.set('count', 1);
    vi.advanceTimersByTime(MINUTE);
    store.remove('count');
    store.set('count', 2);
    const now = Date.now();
    expect(store.meta('count')).toEqual({ createdAt: now, updatedAt: now });
  });

  it('coexist with a ttl', () => {
    const store = createMemoryStorage('s', { timestamps: true, ttl: MINUTE });
    const now = Date.now();
    store.set('count', 1);
    expect(store.meta('count')).toEqual({
      createdAt: now,
      updatedAt: now,
      expiresAt: now + MINUTE,
    });
  });

  it('do not disturb the value itself', () => {
    const store = createMemoryStorage('s', { timestamps: true });
    store.set('when', new Date(1000));
    const read = store.get<Date>('when');
    expect(read).toBeInstanceOf(Date);
    expect(read?.getTime()).toBe(1000);
  });
});

describe('meta()', () => {
  it('is undefined for a key that carries none, and for a missing key', () => {
    const store = createMemoryStorage('s');
    store.set('plain', 1);
    expect(store.meta('plain')).toBeUndefined();
    expect(store.meta('missing')).toBeUndefined();
  });

  it('reports the expiry of a key written with a ttl', () => {
    const store = createMemoryStorage('s');
    const now = Date.now();
    store.set('token', 'x', { ttl: MINUTE });
    expect(store.meta('token')).toEqual({ expiresAt: now + MINUTE });
  });
});

describe('a ttl that makes no sense', () => {
  it('is rejected at construction when it is the namespace default', () => {
    for (const ttl of [0, -1, NaN, Infinity]) {
      expect(() => createMemoryStorage('s', { ttl })).toThrow(InvalidOptionsError);
    }
    expect(() => createMemoryStorage('s', { ttl: 0 })).toThrow(/positive, finite number/);
  });

  it('is rejected at the call site when it is per-write', () => {
    const store = createMemoryStorage('s');
    expect(() => store.set('k', 1, { ttl: -5 })).toThrow(InvalidOptionsError);
    // The bad write must not have landed.
    expect(store.has('k')).toBe(false);
  });
});

describe('ttl alongside the rest of the feature set', () => {
  it('survives validation and typing', () => {
    const auth = createMemoryStorage('auth', {
      schema: { token: t.string() },
      ttl: MINUTE,
    });
    auth.set('token', 'jwt');
    expect(auth.get('token')).toBe('jwt');
    vi.advanceTimersByTime(2 * MINUTE);
    expect(auth.get('token')).toBeUndefined();
  });

  it('is inherited by a child namespace', () => {
    const parent = createMemoryStorage('p', { ttl: MINUTE });
    const child = parent.child('c');
    child.set('k', 1);
    vi.advanceTimersByTime(2 * MINUTE);
    expect(child.get('k')).toBeUndefined();
  });

  it('leaves a plain value on the fast path when nothing needs metadata', () => {
    const store = createLocalStorage('s');
    store.set('a', 1);
    store.set('b', 2, { ttl: MINUTE });
    expect(localStorage.getItem('s:a')).toBe('1');
    expect(localStorage.getItem('s:b')).toContain('__nss');
  });
});

describe('peeking at metadata is defensive', () => {
  it('treats a corrupt entry as having no expiry, leaving onCorrupt to deal with it', () => {
    const store = createLocalStorage('s', { onCorrupt: 'ignore' });
    // Contains the marker, so the fast path does not apply, but it will not parse.
    localStorage.setItem('s:broken', '{"__nss":1,"v":');

    expect(store.keys()).toEqual(['broken']);
    expect(store.has('broken')).toBe(true);
    expect(store.get('broken')).toBeUndefined();
    expect(store.meta('broken')).toBeUndefined();
    expect(store.ttl('broken')).toBeNull();
  });

  it('does not mistake a plain string containing the marker for an envelope', () => {
    const store = createLocalStorage('s');
    store.set('note', 'mentions __nss in passing');
    expect(store.get('note')).toBe('mentions __nss in passing');
    expect(store.meta('note')).toBeUndefined();
    expect(store.keys()).toEqual(['note']);
  });
});
