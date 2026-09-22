import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createLocalStorage, createMemoryStorage } from '../src/store/create.js';
import { resetMemoryAdapters } from '../src/adapters/memory.js';
import { resetNamespaceRegistry } from '../src/namespace/registry.js';
import { t } from '../src/typing/t.js';
import type { StandardSchemaV1 } from '../src/typing/standard.js';
import { InvalidOptionsError, ValidationError } from '../src/errors.js';

beforeEach(() => {
  resetNamespaceRegistry();
  localStorage.clear();
  resetMemoryAdapters();
});

/** A hand-rolled Standard Schema, so the adapter is tested without taking on a dependency. */
function standard<T>(
  check: (value: unknown) => boolean,
  message: string,
  path?: PropertyKey[],
): StandardSchemaV1<T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (value) =>
        check(value) ? { value: value as T } : { issues: [path ? { message, path } : { message }] },
      types: undefined,
    },
  };
}

describe('defaults', () => {
  it('are returned when the key has never been written', () => {
    const basket = createLocalStorage('basket', { defaults: { count: 0, items: [] as string[] } });
    expect(basket.get('count')).toBe(0);
    expect(basket.get('items')).toEqual([]);
    // The default is not written to storage just by reading it.
    expect(basket.has('count')).toBe(false);
    expect(basket.keys()).toEqual([]);
  });

  it('give way to a stored value', () => {
    const basket = createLocalStorage('basket', { defaults: { count: 0 } });
    basket.set('count', 7);
    expect(basket.get('count')).toBe(7);
  });

  it('are cloned, so mutating one read cannot corrupt the fallback', () => {
    const basket = createLocalStorage('basket', { defaults: { items: [] as string[] } });
    const first = basket.get('items');
    first.push('mutated');
    expect(basket.get('items')).toEqual([]);
  });

  it('clones deeply, not just the top level', () => {
    const basket = createMemoryStorage('basket', { defaults: { cfg: { nested: { list: [1] } } } });
    basket.get('cfg').nested.list.push(2);
    expect(basket.get('cfg').nested.list).toEqual([1]);
  });

  it('survive a default holding a Date', () => {
    const when = new Date(1000);
    const basket = createMemoryStorage('basket', { defaults: { lastOpened: when } });
    const read = basket.get('lastOpened');
    expect(read).toBeInstanceOf(Date);
    expect(read.getTime()).toBe(1000);
    expect(read).not.toBe(when);
  });

  it('cover a corrupt stored value', () => {
    const basket = createLocalStorage('basket', { defaults: { count: 0 } });
    localStorage.setItem('basket:count', '{oops');
    expect(basket.get('count')).toBe(0);
  });
});

describe('schema validation', () => {
  it('rejects a bad write, and says what was wrong', () => {
    const basket = createMemoryStorage('basket', { schema: { count: t.number() } });
    let thrown: unknown;
    try {
      basket.set('count', 'ten' as unknown as number);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ValidationError);
    const error = thrown as ValidationError;
    expect(error.code).toBe('VALIDATION');
    expect(error.key).toBe('count');
    expect(error.message).toMatch(/expected a number, received a string/);
    expect(error.issues).toHaveLength(1);
  });

  it('reports the path inside a nested value', () => {
    const store = createMemoryStorage('s', {
      schema: { user: t.object({ name: t.string(), tags: t.array(t.string()) }) },
    });
    try {
      store.set('user', { name: 'a', tags: ['ok', 2] } as never);
      expect.unreachable();
    } catch (error) {
      expect((error as ValidationError).issues[0]?.path).toEqual(['tags', 1]);
    }
  });

  it('ignores an invalid stored value by default and reports it', () => {
    const onError = vi.fn();
    const basket = createLocalStorage('basket', { schema: { count: t.number() }, onError });
    localStorage.setItem('basket:count', '"ten"');

    expect(basket.get('count')).toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(ValidationError);
    expect(localStorage.getItem('basket:count')).toBe('"ten"');
  });

  it('self-heals with onInvalid: remove', () => {
    const basket = createLocalStorage('basket', {
      schema: { count: t.number() },
      onInvalid: 'remove',
    });
    localStorage.setItem('basket:count', '"ten"');
    expect(basket.get('count')).toBeUndefined();
    expect(localStorage.getItem('basket:count')).toBeNull();
  });

  it('fails fast with onInvalid: throw', () => {
    const basket = createLocalStorage('basket', {
      schema: { count: t.number() },
      onInvalid: 'throw',
    });
    localStorage.setItem('basket:count', '"ten"');
    expect(() => basket.get('count')).toThrow(ValidationError);
  });

  it('leaves keys with no schema alone', () => {
    const store = createMemoryStorage('s', { schema: { typed: t.number() } });
    expect(() => store.set('untyped' as never, 'anything' as never)).not.toThrow();
  });
});

describe('defaults and schema together', () => {
  it('lets the schema validate while the default supplies the fallback', () => {
    const store = createMemoryStorage('s', {
      defaults: { count: 5 },
      schema: { count: t.number() },
    });
    expect(store.get('count')).toBe(5);
    expect(() => store.set('count', 'x' as never)).toThrow(ValidationError);
    store.set('count', 9);
    expect(store.get('count')).toBe(9);
  });

  it('falls back to the default when stored data fails the schema', () => {
    const store = createLocalStorage('s', {
      defaults: { count: 5 },
      schema: { count: t.number() },
    });
    localStorage.setItem('s:count', '"ten"');
    expect(store.get('count')).toBe(5);
  });

  it('rejects a default that contradicts its own schema, at construction', () => {
    expect(() =>
      createMemoryStorage('s', {
        defaults: { count: 'zero' },
        schema: { count: t.number() },
      }),
    ).toThrow(/default for "count" does not satisfy its own schema/);
  });

  it('merges the key sets', () => {
    const store = createMemoryStorage('s', {
      defaults: { a: 1 },
      schema: { b: t.string() },
    });
    store.set('b', 'hi');
    expect(store.get('a')).toBe(1);
    expect(store.get('b')).toBe('hi');
  });
});

describe('Standard Schema validators', () => {
  it('accepts a conforming value', () => {
    const store = createMemoryStorage('s', {
      schema: { token: standard<string>((v) => typeof v === 'string', 'expected a string') },
    });
    store.set('token', 'abc');
    expect(store.get('token')).toBe('abc');
  });

  it('rejects a non-conforming value and carries the issue path', () => {
    const store = createMemoryStorage('s', {
      schema: {
        token: standard<string>((v) => typeof v === 'string', 'expected a string', ['inner', 0]),
      },
    });
    try {
      store.set('token', 5 as never);
      expect.unreachable();
    } catch (error) {
      const issues = (error as ValidationError).issues;
      expect(issues[0]?.message).toBe('expected a string');
      expect(issues[0]?.path).toEqual(['inner', 0]);
    }
  });

  it('understands the object-shaped path segments the spec allows', () => {
    const schema: StandardSchemaV1<string> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => ({ issues: [{ message: 'nope', path: [{ key: 'a' }, { key: 1 }] }] }),
        types: undefined,
      },
    };
    const store = createMemoryStorage('s', { schema: { x: schema } });
    try {
      store.set('x', 'anything');
      expect.unreachable();
    } catch (error) {
      expect((error as ValidationError).issues[0]?.path).toEqual(['a', 1]);
    }
  });

  it('refuses an async validator rather than silently ignoring it', () => {
    const asyncSchema: StandardSchemaV1<string> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => Promise.resolve({ value: 'x' }),
        types: undefined,
      },
    };
    const store = createMemoryStorage('s', { schema: { x: asyncSchema } });
    expect(() => store.set('x', 'y')).toThrow(/validates asynchronously/);
  });

  it('rejects something that is neither ours nor a Standard Schema', () => {
    expect(() => createMemoryStorage('s', { schema: { x: { nope: true } } })).toThrow(
      InvalidOptionsError,
    );
  });
});

describe('the built-in t.* schemas', () => {
  const cases: [string, ReturnType<typeof t.string>, unknown, unknown][] = [
    ['string', t.string(), 'a', 1],
    ['number', t.number(), 1, 'a'],
    ['boolean', t.boolean(), true, 'a'],
    ['unknown', t.unknown(), Symbol.iterator, undefined],
    ['date', t.date(), new Date(1), 'a'],
    ['literal', t.literal('on'), 'on', 'off'],
    ['enum', t.enum(['light', 'dark']), 'dark', 'blue'],
    ['array', t.array(t.number()), [1, 2], [1, 'x']],
    ['object', t.object({ a: t.number() }), { a: 1 }, { a: 'x' }],
    ['record', t.record(t.number()), { a: 1 }, { a: 'x' }],
    ['union', t.union([t.number(), t.string()]), 'a', true],
  ] as never;

  for (const [name, schema, good, bad] of cases) {
    it(`${name} accepts and rejects`, () => {
      expect(schema.parse(good).ok).toBe(true);
      if (name !== 'unknown') expect(schema.parse(bad).ok).toBe(false);
    });
  }

  it('rejects a non-finite number, which JSON cannot represent as a number', () => {
    expect(t.number().parse(NaN).ok).toBe(false);
    expect(t.number().parse(Infinity).ok).toBe(false);
  });

  it('rejects an invalid Date', () => {
    expect(t.date().parse(new Date(NaN)).ok).toBe(false);
  });

  it('makes a value optional or nullable without losing the base check', () => {
    expect(t.string().optional().parse(undefined).ok).toBe(true);
    expect(t.string().optional().parse(1).ok).toBe(false);
    expect(t.string().nullable().parse(null).ok).toBe(true);
    expect(t.string().nullable().parse(1).ok).toBe(false);
  });

  it('passes undeclared object properties through rather than dropping stored data', () => {
    const result = t.object({ a: t.number() }).parse({ a: 1, extra: 'kept' });
    expect(result.ok && (result.value as Record<string, unknown>).extra).toBe('kept');
  });

  it('collects every issue in an array, not just the first', () => {
    const result = t.array(t.number()).parse(['x', 'y']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toHaveLength(2);
  });
});

describe('children of a typed store', () => {
  it('are untyped and carry no defaults or validation', () => {
    const basket = createMemoryStorage('basket', {
      defaults: { count: 0 },
      schema: { count: t.number() },
    });
    const ui = basket.child('ui');
    expect(ui.get('count')).toBeUndefined();
    expect(() => ui.set('count', 'anything')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Compile-time behaviour.
//
// These bodies are never invoked — `tsc --noEmit` is what checks them, and several lines would
// (correctly) throw at runtime now that writes are validated. Each is referenced so that
// `noUnusedLocals` still keeps them honest.
// ---------------------------------------------------------------------------

describe('types', () => {
  it('infers value types and key names from defaults', () => {
    const assertions = () => {
      const basket = createMemoryStorage('basket', {
        defaults: { count: 0, items: [] as string[], lastOpened: new Date() },
      });

      // A key with a default never reads back as undefined.
      expectTypeOf(basket.get('count')).toEqualTypeOf<number>();
      expectTypeOf(basket.get('items')).toEqualTypeOf<string[]>();
      expectTypeOf(basket.get('lastOpened')).toEqualTypeOf<Date>();
      expectTypeOf(basket.keys()).toEqualTypeOf<('count' | 'items' | 'lastOpened')[]>();
      expectTypeOf(basket.has).parameter(0).toEqualTypeOf<'count' | 'items' | 'lastOpened'>();

      // @ts-expect-error - 'cout' is not a declared key
      basket.get('cout');
      // @ts-expect-error - count is a number
      basket.set('count', 'ten');
      // @ts-expect-error - 'cout' is not a declared key
      basket.set('cout', 1);
      // @ts-expect-error - remove is restricted to declared keys too
      basket.remove('cout');
    };
    expect(assertions).toBeTypeOf('function');
  });

  it('adds `| undefined` for a schema key with no default', () => {
    const assertions = () => {
      const auth = createMemoryStorage('auth', {
        schema: { token: t.string(), scopes: t.array(t.string()).optional() },
      });

      expectTypeOf(auth.get('token')).toEqualTypeOf<string | undefined>();
      expectTypeOf(auth.get('scopes')).toEqualTypeOf<string[] | undefined>();

      // @ts-expect-error - token is a string
      auth.set('token', 42);
    };
    expect(assertions).toBeTypeOf('function');
  });

  it('lets the schema win the type where both declare a key', () => {
    const assertions = () => {
      const store = createMemoryStorage('s', {
        defaults: { mode: 'light' },
        schema: { mode: t.enum(['light', 'dark']) },
      });
      // 'light' | 'dark' from the schema, and non-optional because a default exists.
      expectTypeOf(store.get('mode')).toEqualTypeOf<'light' | 'dark'>();

      // @ts-expect-error - not a member of the enum
      store.set('mode', 'blue');
    };
    expect(assertions).toBeTypeOf('function');
  });

  it('infers through a Standard Schema validator', () => {
    const assertions = () => {
      const store = createMemoryStorage('s', {
        schema: { token: standard<string>((v) => typeof v === 'string', 'expected a string') },
      });
      expectTypeOf(store.get('token')).toEqualTypeOf<string | undefined>();
    };
    expect(assertions).toBeTypeOf('function');
  });

  it('leaves a store with no declarations fully loose', () => {
    const loose = createMemoryStorage('loose');
    expectTypeOf(loose.get('anything')).toEqualTypeOf<unknown>();
    expectTypeOf(loose.get<number>('anything')).toEqualTypeOf<number | undefined>();
    expectTypeOf(loose.keys()).toEqualTypeOf<string[]>();
    loose.set('whatever', { free: 'form' });
    expect(loose.get('whatever')).toEqual({ free: 'form' });
  });

  it('keeps a child loose even when the parent is typed', () => {
    const typed = createMemoryStorage('typed', { defaults: { count: 0 } });
    expectTypeOf(typed.child('ui').get('anything')).toEqualTypeOf<unknown>();
    expect(typed.child('ui').namespace).toBe('typed:ui');
  });
});

describe('edge cases the coverage gate surfaced', () => {
  it('rejects a non-object for t.object and t.record', () => {
    expect(t.object({ a: t.number() }).parse('nope').ok).toBe(false);
    expect(t.object({ a: t.number() }).parse(null).ok).toBe(false);
    expect(t.object({ a: t.number() }).parse([1]).ok).toBe(false);
    expect(t.record(t.number()).parse('nope').ok).toBe(false);
    expect(t.record(t.number()).parse([1]).ok).toBe(false);
  });

  it('keeps a numeric Standard Schema path segment numeric', () => {
    const schema: StandardSchemaV1<string> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => ({ issues: [{ message: 'nope', path: ['items', 2] }] }),
        types: undefined,
      },
    };
    const store = createMemoryStorage('s', { schema: { x: schema } });
    try {
      store.set('x', 'anything');
      expect.unreachable();
    } catch (error) {
      expect((error as ValidationError).issues[0]?.path).toEqual(['items', 2]);
    }
  });

  it('falls back to the codec when structuredClone is unavailable', () => {
    const original = globalThis.structuredClone;
    // Node 18+ and every evergreen browser have it, but a polyfill-free or patched runtime
    // might not, and defaults must still be isolated there.
    Object.defineProperty(globalThis, 'structuredClone', { configurable: true, value: undefined });
    try {
      const store = createMemoryStorage('s', { defaults: { items: [{ n: 1 }] } });
      const first = store.get('items');
      first[0]!.n = 99;
      expect(store.get('items')).toEqual([{ n: 1 }]);
    } finally {
      Object.defineProperty(globalThis, 'structuredClone', {
        configurable: true,
        value: original,
      });
    }
  });

  it('falls back to the codec when structuredClone throws', () => {
    const original = globalThis.structuredClone;
    Object.defineProperty(globalThis, 'structuredClone', {
      configurable: true,
      value: () => {
        throw new DOMException('cannot clone', 'DataCloneError');
      },
    });
    try {
      const store = createMemoryStorage('s', { defaults: { items: [1] } });
      expect(store.get('items')).toEqual([1]);
    } finally {
      Object.defineProperty(globalThis, 'structuredClone', {
        configurable: true,
        value: original,
      });
    }
  });

  it('returns a primitive default without cloning it', () => {
    const store = createMemoryStorage('s', { defaults: { n: 1, s: 'x', b: true, nil: null } });
    expect([store.get('n'), store.get('s'), store.get('b'), store.get('nil')]).toEqual([
      1,
      'x',
      true,
      null,
    ]);
  });
});
