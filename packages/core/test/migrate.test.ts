import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMemoryAdapters } from '../src/adapters/memory.js';
import {
  DecodeError,
  InvalidOptionsError,
  MigrationError,
  ValidationError,
} from '../src/errors.js';
import { resetNamespaceRegistry } from '../src/namespace/registry.js';
import { createLocalStorage, createMemoryStorage } from '../src/full.js';
import type { MigrateFn } from '../src/types.js';
import { t } from '../src/typing/t.js';

beforeEach(() => {
  resetNamespaceRegistry();
  localStorage.clear();
  resetMemoryAdapters();
});

const stamp = (namespace = 'basket'): string | null =>
  localStorage.getItem(`${namespace}:__nss:meta`);

describe('paying nothing for a version you never asked for', () => {
  it('writes no record and reads nothing when version is left out', () => {
    const basket = createLocalStorage('basket');
    basket.set('count', 1);

    expect(stamp()).toBeNull();
    expect(localStorage.length).toBe(1);
  });

  it('writes no record at version 1 either', () => {
    createLocalStorage('basket', { version: 1 });
    expect(stamp()).toBeNull();
  });
});

describe('stamping', () => {
  it('records the version on a fresh namespace without running a migration', () => {
    const migrate = vi.fn();
    createLocalStorage('basket', { version: 2, migrate });

    expect(stamp()).toBe('{"v":2}');
    expect(migrate).not.toHaveBeenCalled();
  });

  it('records it under the app prefix when there is one', () => {
    createLocalStorage('basket', { prefix: 'myapp', version: 2 });
    expect(localStorage.getItem('myapp:basket:__nss:meta')).toBe('{"v":2}');
  });

  it('follows a custom separator', () => {
    localStorage.setItem('basket/count', '1');
    const migrate = vi.fn<MigrateFn>((previous) => previous);

    createLocalStorage('basket', { separator: '/', version: 2, migrate });

    expect(migrate).toHaveBeenCalledWith({ count: 1 }, 1);
    expect(localStorage.getItem('basket/__nss:meta')).toBe('{"v":2}');
  });

  it('bumps a version with no migration, leaving the data alone', () => {
    localStorage.setItem('basket:count', '3');
    localStorage.setItem('basket:__nss:meta', '{"v":2}');

    const basket = createLocalStorage('basket', { version: 4 });

    expect(stamp()).toBe('{"v":4}');
    expect(basket.get('count')).toBe(3);
  });

  it('does not rewrite a record that already says the right thing', () => {
    localStorage.setItem('basket:__nss:meta', '{"v":2}');
    const setItem = vi.spyOn(localStorage, 'setItem');

    createLocalStorage('basket', { version: 2 });

    expect(setItem.mock.calls.map(([key]) => key)).not.toContain('basket:__nss:meta');
    setItem.mockRestore();
  });

  it('keeps the record out of keys(), size, entries() and clear()', () => {
    const basket = createLocalStorage('basket', { version: 2 });
    basket.set('count', 1);

    expect(basket.keys()).toEqual(['count']);
    expect(basket.size).toBe(1);
    expect(basket.entries()).toEqual([['count', 1]]);

    basket.clear();
    expect(stamp()).toBeNull();
  });
});

describe('running a migration', () => {
  it('treats unstamped data as version 1 and migrates it', () => {
    localStorage.setItem('basket:count', '3');
    const migrate = vi.fn<MigrateFn>((previous) => ({
      total: (previous.count as number) * 10,
    }));

    const basket = createLocalStorage('basket', { version: 2, migrate });

    expect(migrate).toHaveBeenCalledWith({ count: 3 }, 1);
    expect(basket.get('total')).toBe(30);
    expect(basket.has('count')).toBe(false);
    expect(stamp()).toBe('{"v":2}');
  });

  it('accepts a migration that mutates the snapshot and returns nothing', () => {
    localStorage.setItem('basket:token', '"secret"');
    localStorage.setItem('basket:count', '2');

    const basket = createLocalStorage('basket', {
      version: 2,
      migrate: (previous) => {
        delete previous.token;
      },
    });

    expect(basket.has('token')).toBe(false);
    expect(basket.get('count')).toBe(2);
  });

  it('is told which version it is coming from, and runs once across several bumps', () => {
    localStorage.setItem('basket:count', '1');
    localStorage.setItem('basket:__nss:meta', '{"v":2}');
    const migrate = vi.fn<MigrateFn>((previous) => previous);

    createLocalStorage('basket', { version: 5, migrate });

    expect(migrate).toHaveBeenCalledTimes(1);
    expect(migrate.mock.calls[0]?.[1]).toBe(2);
    expect(stamp()).toBe('{"v":5}');
  });

  it('does not run again once the version is recorded', () => {
    localStorage.setItem('basket:count', '1');
    const migrate = vi.fn<MigrateFn>((previous) => previous);

    createLocalStorage('basket', { version: 2, migrate, strict: false });
    createLocalStorage('basket', { version: 2, migrate, strict: false });

    expect(migrate).toHaveBeenCalledTimes(1);
  });

  it('sees decoded values, so a Date arrives as a Date', () => {
    const seed = createLocalStorage('basket', { strict: false });
    seed.set('lastOpened', new Date('2026-01-01T00:00:00.000Z'));

    let seen: unknown;
    createLocalStorage('basket', {
      version: 2,
      strict: false,
      migrate: (previous) => {
        seen = previous.lastOpened;
      },
    });

    expect(seen).toBeInstanceOf(Date);
    expect((seen as Date).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('sees the stored value, not the default a schema would have substituted', () => {
    localStorage.setItem('basket:count', '"3"');
    const migrate = vi.fn<MigrateFn>((previous) => ({
      count: Number(previous.count),
    }));

    const basket = createLocalStorage('basket', {
      defaults: { count: 0 },
      schema: { count: t.number() },
      version: 2,
      migrate,
    });

    expect(migrate).toHaveBeenCalledWith({ count: '3' }, 1);
    expect(basket.get('count')).toBe(3);
  });

  it('leaves an untouched key exactly as it was, timestamps and all', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));

    const seed = createLocalStorage('basket', { timestamps: true, strict: false });
    seed.set('count', 1);
    seed.set('token', 'old');
    const before = localStorage.getItem('basket:count');

    vi.setSystemTime(new Date('2026-09-22T00:00:00.000Z'));
    const basket = createLocalStorage('basket', {
      timestamps: true,
      strict: false,
      version: 2,
      migrate: (previous) => ({ ...previous, token: 'new' }),
    });

    expect(localStorage.getItem('basket:count')).toBe(before);
    expect(basket.meta('token')?.updatedAt).toBe(Date.parse('2026-09-22T00:00:00.000Z'));
    vi.useRealTimers();
  });

  it('skips an expired key and never hands it to the migration', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));

    const seed = createLocalStorage('basket', { strict: false });
    seed.set('token', 'jwt', { ttl: 1000 });
    seed.set('count', 1);

    vi.advanceTimersByTime(2000);
    const migrate = vi.fn<MigrateFn>((previous) => previous);
    createLocalStorage('basket', { version: 2, migrate, strict: false });

    expect(migrate).toHaveBeenCalledWith({ count: 1 }, 1);
    vi.useRealTimers();
  });

  it('leaves a value it could not read on disk rather than deleting it by omission', () => {
    localStorage.setItem('basket:count', '1');
    localStorage.setItem('basket:broken', '{oops');
    const onError = vi.fn();

    const migrate = vi.fn<MigrateFn>((previous) => previous);
    createLocalStorage('basket', { version: 2, migrate, onError });

    expect(migrate).toHaveBeenCalledWith({ count: 1 }, 1);
    expect(localStorage.getItem('basket:broken')).toBe('{oops');
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(DecodeError);
  });

  it('keeps the migrated data when only the version record cannot be written', () => {
    localStorage.setItem('basket:count', '1');
    const onError = vi.fn();
    // Spied on the instance: happy-dom hands out a cached bound method, so a prototype spy
    // installed after the first write is never reached.
    const write = localStorage.setItem.bind(localStorage);
    const setItem = vi
      .spyOn(localStorage, 'setItem')
      .mockImplementation((key: string, value: string) => {
        // Everything is writable except the one key that records the version.
        if (key.endsWith('__nss:meta')) throw new DOMException('full', 'QuotaExceededError');
        write(key, value);
      });

    createLocalStorage('basket', {
      version: 2,
      onError,
      migrate: (previous) => ({ ...previous, migrated: true }),
    });

    const error = onError.mock.calls[0]?.[0] as MigrationError;
    expect(error).toBeInstanceOf(MigrationError);
    expect(error.message).toMatch(/could not be recorded/);
    setItem.mockRestore();

    expect(localStorage.getItem('basket:migrated')).toBe('true');
    expect(stamp()).toBeNull();
  });

  it('works on a store with no browser storage at all', () => {
    createMemoryStorage('basket', { strict: false }).set('count', 1);

    const store = createMemoryStorage('basket', {
      strict: false,
      version: 2,
      migrate: (previous) => ({ ...previous, migrated: true }),
    });

    expect(store.get('migrated')).toBe(true);
    expect(store.get('count')).toBe(1);
  });
});

describe('when a migration fails', () => {
  it('reports and throws when it raises, leaving both data and version alone', () => {
    localStorage.setItem('basket:count', '1');
    const onError = vi.fn();
    const boom = new Error('bad data');

    expect(() =>
      createLocalStorage('basket', {
        version: 2,
        onError,
        migrate: () => {
          throw boom;
        },
      }),
    ).toThrow(MigrationError);

    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(MigrationError);
    expect(localStorage.getItem('basket:count')).toBe('1');
    expect(stamp()).toBeNull();
  });

  it('retries on the next construction, because the version never advanced', () => {
    localStorage.setItem('basket:count', '1');
    const migrate = vi.fn(() => {
      throw new Error('nope');
    });

    expect(() => createLocalStorage('basket', { version: 2, migrate, strict: false })).toThrow(
      MigrationError,
    );
    expect(() => createLocalStorage('basket', { version: 2, migrate, strict: false })).toThrow(
      MigrationError,
    );
    expect(migrate).toHaveBeenCalledTimes(2);
  });

  it('carries the versions it was moving between', () => {
    localStorage.setItem('basket:count', '1');
    localStorage.setItem('basket:__nss:meta', '{"v":2}');

    try {
      createLocalStorage('basket', {
        version: 3,
        migrate: () => {
          throw new Error('nope');
        },
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MigrationError);
      expect((error as MigrationError).fromVersion).toBe(2);
      expect((error as MigrationError).toVersion).toBe(3);
      expect((error as MigrationError).code).toBe('MIGRATION');
    }
  });

  it.each([
    ['an array', () => [1, 2]],
    ['null', () => null],
    ['a primitive', () => 42],
  ])('rejects a return of %s', (_label, migrate) => {
    localStorage.setItem('basket:count', '1');
    expect(() =>
      createLocalStorage('basket', { version: 2, migrate: migrate as () => never }),
    ).toThrow(MigrationError);
    expect(stamp()).toBeNull();
  });

  it('rejects a promise, because storage has nowhere to await it', () => {
    localStorage.setItem('basket:count', '1');
    expect(() =>
      createLocalStorage('basket', {
        version: 2,
        migrate: (() => Promise.resolve({})) as () => never,
      }),
    ).toThrow(/returned a promise/);
  });

  it('rejects a value its own schema refuses, and does not advance the version', () => {
    localStorage.setItem('basket:count', '1');
    const onError = vi.fn();

    expect(() =>
      createLocalStorage('basket', {
        schema: { count: t.number() },
        version: 2,
        onError,
        migrate: () => ({ count: 'three' }),
      }),
    ).toThrow(MigrationError);

    const error = onError.mock.calls[0]?.[0] as MigrationError;
    expect(error.cause).toBeInstanceOf(ValidationError);
    expect(stamp()).toBeNull();
  });

  it('rejects a reserved key written by the migration', () => {
    localStorage.setItem('basket:count', '1');
    expect(() =>
      createLocalStorage('basket', { version: 2, migrate: () => ({ __nssSneaky: 1 }) }),
    ).toThrow(MigrationError);
  });
});

describe('a version the code does not expect', () => {
  it('reports a rollback and touches neither the data nor the record', () => {
    localStorage.setItem('basket:count', '1');
    localStorage.setItem('basket:__nss:meta', '{"v":3}');
    const onError = vi.fn();
    const migrate = vi.fn();

    const basket = createLocalStorage('basket', { version: 2, migrate, onError });

    expect(migrate).not.toHaveBeenCalled();
    expect(stamp()).toBe('{"v":3}');
    expect(basket.get('count')).toBe(1);
    const error = onError.mock.calls[0]?.[0] as MigrationError;
    expect(error).toBeInstanceOf(MigrationError);
    expect(error.fromVersion).toBe(3);
  });

  it.each(['{oops', '"two"', '{"v":0}', '{"v":1.5}'])(
    'repairs an unreadable record (%s) without migrating',
    (record) => {
      localStorage.setItem('basket:count', '1');
      localStorage.setItem('basket:__nss:meta', record);
      const onError = vi.fn();
      const migrate = vi.fn();

      createLocalStorage('basket', { version: 2, migrate, onError });

      expect(migrate).not.toHaveBeenCalled();
      expect(localStorage.getItem('basket:count')).toBe('1');
      expect(stamp()).toBe('{"v":2}');
      expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(MigrationError);
    },
  );
});

describe('malformed options', () => {
  it.each([0, -1, 1.5, Number.NaN])('rejects version %s', (version) => {
    expect(() => createLocalStorage('basket', { version })).toThrow(InvalidOptionsError);
  });

  it('rejects a migration that could never run', () => {
    expect(() => createLocalStorage('basket', { migrate: (p) => p })).toThrow(/could never run/);
    expect(() => createLocalStorage('basket', { version: 1, migrate: (p) => p })).toThrow(
      InvalidOptionsError,
    );
  });

  it('reports the malformed option before the namespace is even registered', () => {
    expect(() => createLocalStorage('basket', { version: 0 })).toThrow(InvalidOptionsError);
    // The failed construction must not have claimed the namespace.
    expect(() => createLocalStorage('basket', { version: 2 })).not.toThrow();
  });
});

describe('children', () => {
  it('does not stamp or migrate a child view of the namespace', () => {
    const migrate = vi.fn<MigrateFn>((previous) => previous);
    const basket = createLocalStorage('basket', { version: 2, migrate });
    const ui = basket.child('ui');
    ui.set('collapsed', true);

    expect(localStorage.getItem('basket:ui:__nss:meta')).toBeNull();
    expect(migrate).not.toHaveBeenCalled();
  });
});
