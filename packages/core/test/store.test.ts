import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalStorage, createSessionStorage } from '../src/store/create.js';
import { resetMemoryAdapters } from '../src/adapters/memory.js';
import { resetNamespaceRegistry } from '../src/namespace/registry.js';
import {
  DecodeError,
  InvalidKeyError,
  InvalidNamespaceError,
  SerializationError,
} from '../src/errors.js';

beforeEach(() => {
  resetNamespaceRegistry();
  localStorage.clear();
  sessionStorage.clear();
  resetMemoryAdapters();
});

describe('namespacing', () => {
  it('prefixes every key it writes', () => {
    const basket = createLocalStorage('basket');
    basket.set('count', 10);
    expect(localStorage.getItem('basket:count')).toBe('10');
    expect(basket.namespace).toBe('basket');
    expect(basket.available).toBe(true);
  });

  it('applies an app-wide prefix when given', () => {
    const basket = createLocalStorage('basket', { prefix: 'myapp' });
    basket.set('count', 1);
    expect(localStorage.getItem('myapp:basket:count')).toBe('1');
    expect(basket.namespace).toBe('myapp:basket');
  });

  it('isolates namespaces from each other', () => {
    const basket = createLocalStorage('basket');
    const auth = createLocalStorage('auth');
    basket.set('token', 'from-basket');
    auth.set('token', 'from-auth');
    expect(basket.get('token')).toBe('from-basket');
    expect(auth.get('token')).toBe('from-auth');
  });

  it('rejects an invalid namespace at construction', () => {
    expect(() => createLocalStorage('bas:ket')).toThrow(InvalidNamespaceError);
    expect(() => createLocalStorage('')).toThrow(InvalidNamespaceError);
  });
});

describe('clear is namespace-scoped', () => {
  it('leaves other namespaces and foreign keys untouched', () => {
    const basket = createLocalStorage('basket');
    const auth = createLocalStorage('auth');
    localStorage.setItem('written-by-someone-else', 'keep me');
    basket.set('count', 1);
    basket.set('items', [1, 2]);
    auth.set('token', 'abc');

    basket.clear();

    expect(basket.size).toBe(0);
    expect(auth.get('token')).toBe('abc');
    expect(localStorage.getItem('written-by-someone-else')).toBe('keep me');
  });

  it('does not clear a namespace that merely shares a prefix', () => {
    const basket = createLocalStorage('basket');
    const basketball = createLocalStorage('basketball');
    basket.set('a', 1);
    basketball.set('a', 2);

    basket.clear();

    expect(basketball.get('a')).toBe(2);
  });
});

describe('core operations', () => {
  it('round-trips every JSON-native type', () => {
    const store = createLocalStorage('types');
    const values: [string, unknown][] = [
      ['number', 10],
      ['negative', -3.5],
      ['string', 'hello'],
      ['boolean', true],
      ['null', null],
      ['array', [1, 'two', false]],
      ['object', { a: 1, b: { c: [2] } }],
      ['empty-string', ''],
      ['zero', 0],
      ['false', false],
    ];
    for (const [key, value] of values) store.set(key, value);
    for (const [key, value] of values) expect(store.get(key)).toEqual(value);
  });

  it('distinguishes a stored falsy value from a missing key', () => {
    const store = createLocalStorage('falsy');
    store.set('zero', 0);
    expect(store.get('zero')).toBe(0);
    expect(store.has('zero')).toBe(true);
    expect(store.get('missing')).toBeUndefined();
    expect(store.has('missing')).toBe(false);
  });

  it('treats set(key, undefined) as a removal', () => {
    const store = createLocalStorage('basket');
    store.set('count', 1);
    store.set('count', undefined);
    expect(store.has('count')).toBe(false);
  });

  it('reports keys, entries and size without the namespace prefix', () => {
    const store = createLocalStorage('basket');
    store.set('count', 1);
    store.set('items', ['a']);
    expect(store.keys().sort()).toEqual(['count', 'items']);
    expect(store.size).toBe(2);
    expect(Object.fromEntries(store.entries())).toEqual({ count: 1, items: ['a'] });
  });

  it('hides reserved internal keys from enumeration', () => {
    const store = createLocalStorage('basket');
    store.set('count', 1);
    localStorage.setItem('basket:__nss:meta', '{"version":1}');
    expect(store.keys()).toEqual(['count']);
    expect(store.size).toBe(1);
  });

  it('rejects reserved keys on read and write', () => {
    const store = createLocalStorage('basket');
    expect(() => store.set('__nss:meta', 1)).toThrow(InvalidKeyError);
    expect(() => store.get('__nss:meta')).toThrow(InvalidKeyError);
  });

  it('exposes native-style aliases', () => {
    const store = createLocalStorage('basket');
    store.setItem('count', 5);
    expect(store.getItem('count')).toBe(5);
    store.removeItem('count');
    expect(store.getItem('count')).toBeUndefined();
  });
});

describe('interoperability with raw storage', () => {
  it('reads a plain value written before the package was adopted', () => {
    localStorage.setItem('basket:count', '10');
    const store = createLocalStorage('basket');
    expect(store.get('count')).toBe(10);
  });

  it('writes exactly what JSON.stringify would have written', () => {
    const store = createLocalStorage('basket');
    store.set('items', [{ id: 'sku-1', qty: 2 }]);
    expect(localStorage.getItem('basket:items')).toBe(JSON.stringify([{ id: 'sku-1', qty: 2 }]));
  });
});

describe('child namespaces', () => {
  it('nests under the parent and stays scoped', () => {
    const basket = createLocalStorage('basket');
    const ui = basket.child('ui');
    ui.set('collapsed', true);

    expect(localStorage.getItem('basket:ui:collapsed')).toBe('true');
    expect(ui.namespace).toBe('basket:ui');
    // The child's keys are visible to the parent as a prefixed key, not as a bare one.
    expect(basket.keys()).toEqual(['ui:collapsed']);
  });

  it('clearing the parent clears its children too', () => {
    const basket = createLocalStorage('basket');
    basket.child('ui').set('collapsed', true);
    basket.clear();
    expect(basket.child('ui').get('collapsed')).toBeUndefined();
  });

  it('rejects an invalid child segment', () => {
    expect(() => createLocalStorage('basket').child('a:b')).toThrow(InvalidNamespaceError);
  });
});

describe('corrupt data', () => {
  it('ignores it by default and reports through onError', () => {
    const onError = vi.fn();
    const store = createLocalStorage('basket', { onError });
    localStorage.setItem('basket:items', '{oops');

    expect(store.get('items')).toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(DecodeError);
    // 'ignore' leaves the bad value in place for inspection.
    expect(localStorage.getItem('basket:items')).toBe('{oops');
  });

  it('self-heals with onCorrupt: remove', () => {
    const store = createLocalStorage('basket', { onCorrupt: 'remove' });
    localStorage.setItem('basket:items', '{oops');
    expect(store.get('items')).toBeUndefined();
    expect(localStorage.getItem('basket:items')).toBeNull();
  });

  it('fails fast with onCorrupt: throw', () => {
    const store = createLocalStorage('basket', { onCorrupt: 'throw' });
    localStorage.setItem('basket:items', '{oops');
    expect(() => store.get('items')).toThrow(DecodeError);
  });

  it('survives an onError handler that itself throws', () => {
    const store = createLocalStorage('basket', {
      onError: () => {
        throw new Error('handler blew up');
      },
    });
    localStorage.setItem('basket:items', '{oops');
    expect(store.get('items')).toBeUndefined();
  });
});

describe('unserializable values', () => {
  it('rejects a circular structure', () => {
    const store = createLocalStorage('basket');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => store.set('bad', circular)).toThrow(SerializationError);
  });

  it('rejects a function', () => {
    const store = createLocalStorage('basket');
    expect(() => store.set('bad', () => {})).toThrow(/no JSON representation/);
  });
});

describe('sessionStorage', () => {
  it('writes to sessionStorage and not localStorage', () => {
    const auth = createSessionStorage('auth');
    auth.set('token', 'abc');
    expect(sessionStorage.getItem('auth:token')).toBe('"abc"');
    expect(localStorage.getItem('auth:token')).toBeNull();
    expect(auth.adapter).toBe('sessionStorage');
  });
});
