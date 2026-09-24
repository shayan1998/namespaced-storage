import { beforeEach, describe, expect, it } from 'vitest';
import { decode, encode } from '../src/codec/envelope.js';
import { createLocalStorage } from '../src/full.js';
import { resetMemoryAdapters } from '../src/adapters/memory.js';
import { resetNamespaceRegistry } from '../src/namespace/registry.js';
import { DecodeError, SerializationError } from '../src/errors.js';

beforeEach(() => {
  resetNamespaceRegistry();
  localStorage.clear();
  resetMemoryAdapters();
});

/** Encode then decode, the way a real write/read pair would. */
function roundTrip(value: unknown): unknown {
  return decode(encode(value, 'ns', 'k'), 'ns', 'k').value;
}

function stored(value: unknown): string {
  return encode(value, 'ns', 'k');
}

describe('the plain path', () => {
  it('writes JSON-native values exactly as JSON.stringify would', () => {
    for (const value of [10, 'hi', true, null, [1, 2], { a: { b: 1 } }, [], {}]) {
      expect(stored(value)).toBe(JSON.stringify(value));
    }
  });

  it('never reaches for an envelope when nothing needs one', () => {
    expect(stored({ a: 1, b: [2, 'three'] })).not.toContain('__nss');
  });

  it('reads a value written by code that predates this package', () => {
    expect(decode('{"legacy":true}', 'ns', 'k').value).toEqual({ legacy: true });
    expect(decode('42', 'ns', 'k').value).toBe(42);
  });
});

describe('Date', () => {
  it('round-trips at the top level', () => {
    const date = new Date('2026-09-19T14:00:00.000Z');
    const result = roundTrip(date);
    expect(result).toBeInstanceOf(Date);
    expect((result as Date).toISOString()).toBe(date.toISOString());
  });

  it('round-trips nested inside objects and arrays', () => {
    const value = { user: { lastSeen: new Date(1000) }, history: [new Date(2000)] };
    const result = roundTrip(value) as typeof value;
    expect(result.user.lastSeen).toBeInstanceOf(Date);
    expect(result.user.lastSeen.getTime()).toBe(1000);
    expect(result.history[0]).toBeInstanceOf(Date);
    expect(result.history[0]?.getTime()).toBe(2000);
  });

  it('preserves an invalid Date rather than silently becoming the epoch', () => {
    const result = roundTrip(new Date(NaN));
    expect(result).toBeInstanceOf(Date);
    expect(Number.isNaN((result as Date).getTime())).toBe(true);
  });
});

describe('Map and Set', () => {
  it('round-trips a Map, including non-string keys', () => {
    const map = new Map<unknown, unknown>([
      ['a', 1],
      [2, 'two'],
      [true, null],
    ]);
    const result = roundTrip(map) as Map<unknown, unknown>;
    expect(result).toBeInstanceOf(Map);
    expect([...result]).toEqual([...map]);
  });

  it('revives values nested inside a Map', () => {
    const map = new Map([['when', new Date(5000)]]);
    const result = roundTrip(map) as Map<string, Date>;
    expect(result.get('when')).toBeInstanceOf(Date);
    expect(result.get('when')?.getTime()).toBe(5000);
  });

  it('revives keys nested inside a Map', () => {
    const key = new Date(7000);
    const result = roundTrip(new Map([[key, 'v']])) as Map<Date, string>;
    const revivedKey = [...result][0]?.[0];
    expect(revivedKey).toBeInstanceOf(Date);
    expect(revivedKey?.getTime()).toBe(7000);
  });

  it('round-trips a Set, including one holding Dates', () => {
    const result = roundTrip(new Set([1, 'two', new Date(3000)])) as Set<unknown>;
    expect(result).toBeInstanceOf(Set);
    const entries = [...result];
    expect(entries[0]).toBe(1);
    expect(entries[2]).toBeInstanceOf(Date);
  });

  it('handles a Map inside a Set inside an object', () => {
    const value = { outer: new Set([new Map([['d', new Date(9)]])]) };
    const result = roundTrip(value) as typeof value;
    const innerMap = [...result.outer][0];
    expect(innerMap).toBeInstanceOf(Map);
    expect(innerMap?.get('d')).toBeInstanceOf(Date);
    expect(innerMap?.get('d')?.getTime()).toBe(9);
  });
});

describe('other non-JSON values', () => {
  it('round-trips BigInt', () => {
    expect(roundTrip(9007199254740993n)).toBe(9007199254740993n);
  });

  it('round-trips RegExp with its flags', () => {
    const result = roundTrip(/ab+c/giu) as RegExp;
    expect(result).toBeInstanceOf(RegExp);
    expect(result.source).toBe('ab+c');
    expect(result.flags).toBe('giu');
  });

  it('preserves NaN and the infinities, which JSON turns into null', () => {
    expect(JSON.parse(JSON.stringify({ n: NaN })).n).toBeNull(); // the bug we are fixing
    expect(roundTrip(NaN)).toBeNaN();
    expect(roundTrip(Infinity)).toBe(Infinity);
    expect(roundTrip(-Infinity)).toBe(-Infinity);
    expect(roundTrip({ a: NaN, b: [Infinity] })).toEqual({ a: NaN, b: [Infinity] });
  });

  it('preserves a nested undefined, which JSON drops entirely', () => {
    expect(JSON.parse(JSON.stringify({ a: 1, b: undefined }))).toEqual({ a: 1 }); // the bug
    const result = roundTrip({ a: 1, b: undefined }) as Record<string, unknown>;
    expect('b' in result).toBe(true);
    expect(result.b).toBeUndefined();
  });

  it('honours toJSON, as JSON.stringify does', () => {
    class Money {
      constructor(private readonly cents: number) {}
      toJSON() {
        return { cents: this.cents };
      }
    }
    expect(roundTrip(new Money(500))).toEqual({ cents: 500 });
  });
});

describe('values that look like our own envelope', () => {
  it('wraps a user object carrying a top-level __nss so the round trip stays exact', () => {
    const value = { __nss: 5, foo: 1 };
    const raw = stored(value);
    expect(raw).toBe('{"__nss":1,"v":{"__nss":5,"foo":1}}');
    expect(roundTrip(value)).toEqual(value);
  });

  it('leaves a nested __nss on the plain path', () => {
    const value = { inner: { __nss: 5 } };
    expect(stored(value)).toBe(JSON.stringify(value));
    expect(roundTrip(value)).toEqual(value);
  });

  it('does not mistake a non-numeric __nss for an envelope', () => {
    const value = { __nss: 'not a version' };
    expect(stored(value)).toBe(JSON.stringify(value));
    expect(roundTrip(value)).toEqual(value);
  });
});

describe('envelope metadata', () => {
  it('is carried through and read back', () => {
    const raw = encode(1, 'ns', 'k', { c: 100, u: 200, e: 300 });
    expect(decode(raw, 'ns', 'k').meta).toEqual({ c: 100, u: 200, e: 300 });
  });

  it('forces an envelope even for a value that would otherwise be plain', () => {
    expect(encode(1, 'ns', 'k', { e: 300 })).toContain('__nss');
  });

  it('is reported as undefined when the envelope carries none', () => {
    expect(decode(encode(new Date(1), 'ns', 'k'), 'ns', 'k').meta).toBeUndefined();
  });
});

describe('hostile stored data', () => {
  it('rejects an envelope written by a newer version of the package', () => {
    expect(() => decode('{"__nss":99,"v":1}', 'ns', 'k')).toThrow(/only understands v1/);
  });

  it('rejects unparseable JSON', () => {
    expect(() => decode('{oops', 'ns', 'k')).toThrow(DecodeError);
  });

  it('reports a tag whose payload no longer matches', () => {
    // A hand-edited value: tagged as a bigint but holding something that is not one.
    expect(() => decode('{"__nss":1,"v":"nope","t":[[[],"bigint"]]}', 'ns', 'k')).toThrow(
      DecodeError,
    );
  });

  it('ignores a tag pointing at a path that no longer exists', () => {
    const raw = '{"__nss":1,"v":{"a":1},"t":[[["gone","deep"],"date"]]}';
    expect(decode(raw, 'ns', 'k').value).toEqual({ a: 1 });
  });

  it('tolerates a malformed tag list', () => {
    expect(decode('{"__nss":1,"v":7,"t":"not an array"}', 'ns', 'k').value).toBe(7);
  });
});

describe('values that cannot be serialized', () => {
  it('names the path of a circular reference', () => {
    const value: Record<string, unknown> = { a: { b: {} } };
    (value.a as Record<string, unknown>).self = value;
    expect(() => stored(value)).toThrow(/circular reference at a.self/);
  });

  it('allows the same object to appear twice without calling it circular', () => {
    const shared = { x: 1 };
    expect(roundTrip({ one: shared, two: shared })).toEqual({ one: { x: 1 }, two: { x: 1 } });
  });

  it('names the path of a nested function', () => {
    expect(() => stored({ deep: { fn: () => {} } })).toThrow(SerializationError);
    expect(() => stored({ deep: { fn: () => {} } })).toThrow(/at deep.fn/);
  });

  it('rejects a symbol', () => {
    expect(() => stored({ s: Symbol('x') })).toThrow(/a symbol has no JSON representation/);
  });
});

describe('through the store', () => {
  it('gives back a real Date', () => {
    const basket = createLocalStorage('basket');
    basket.set('lastOpened', new Date('2026-09-19T14:00:00.000Z'));
    const value = basket.get<Date>('lastOpened');
    expect(value).toBeInstanceOf(Date);
    expect(value?.toISOString()).toBe('2026-09-19T14:00:00.000Z');
  });

  it('keeps plain values readable by anything else on the origin', () => {
    const basket = createLocalStorage('basket');
    basket.set('count', 10);
    basket.set('items', [{ id: 'sku-1', qty: 2 }]);
    expect(localStorage.getItem('basket:count')).toBe('10');
    expect(localStorage.getItem('basket:items')).toBe('[{"id":"sku-1","qty":2}]');
  });

  it('only pays for an envelope on the key that needs one', () => {
    const basket = createLocalStorage('basket');
    basket.set('count', 10);
    basket.set('lastOpened', new Date(0));
    expect(localStorage.getItem('basket:count')).toBe('10');
    expect(localStorage.getItem('basket:lastOpened')).toBe('{"__nss":1,"v":0,"t":[[[],"date"]]}');
  });

  it('applies the configured onCorrupt policy to a revival failure', () => {
    const basket = createLocalStorage('basket', { onCorrupt: 'remove' });
    localStorage.setItem('basket:x', '{"__nss":1,"v":"nope","t":[[[],"bigint"]]}');
    expect(basket.get('x')).toBeUndefined();
    expect(localStorage.getItem('basket:x')).toBeNull();
  });

  it('round-trips a realistic mixed payload', () => {
    const basket = createLocalStorage('basket');
    const value = {
      count: 3,
      updatedAt: new Date(1_700_000_000_000),
      tags: new Set(['sale', 'new']),
      byId: new Map([['sku-1', { qty: 2, addedAt: new Date(1_700_000_001_000) }]]),
      ratio: Infinity,
      note: undefined,
    };
    basket.set('state', value);
    const result = basket.get<typeof value>('state');

    expect(result?.count).toBe(3);
    expect(result?.updatedAt).toBeInstanceOf(Date);
    expect(result?.tags).toBeInstanceOf(Set);
    expect([...(result?.tags ?? [])]).toEqual(['sale', 'new']);
    expect(result?.byId.get('sku-1')?.addedAt).toBeInstanceOf(Date);
    expect(result?.ratio).toBe(Infinity);
    expect('note' in (result ?? {})).toBe(true);
  });
});
