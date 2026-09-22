import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  createLocalStorage,
  createMemoryStorage,
  createSessionStorage,
} from '../src/store/create.js';
import { resetMemoryAdapters } from '../src/adapters/memory.js';
import { SubscriberError } from '../src/errors.js';
import { t } from '../src/typing/t.js';
import type { ChangeEvent } from '../src/types.js';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetMemoryAdapters();
});

/**
 * What another tab looks like from in here: the native event carries raw strings, and the browser
 * never fires it in the tab that did the writing.
 */
function fromAnotherTab(
  key: string | null,
  newValue: string | null,
  oldValue: string | null = null,
  area: Storage = localStorage,
): void {
  window.dispatchEvent(new StorageEvent('storage', { key, newValue, oldValue, storageArea: area }));
}

describe('local changes', () => {
  it('notify a key subscriber with the decoded values', () => {
    const basket = createLocalStorage('basket');
    const seen: ChangeEvent[] = [];
    basket.subscribe('count', (event) => seen.push(event));

    basket.set('count', 10);
    basket.set('count', 11);

    expect(seen).toEqual([
      { key: 'count', newValue: 10, oldValue: undefined, source: 'local' },
      { key: 'count', newValue: 11, oldValue: 10, source: 'local' },
    ]);
  });

  it('report a removal as undefined', () => {
    const basket = createLocalStorage('basket');
    basket.set('count', 10);
    const seen: ChangeEvent[] = [];
    basket.subscribe('count', (event) => seen.push(event));

    basket.remove('count');

    expect(seen).toEqual([{ key: 'count', newValue: undefined, oldValue: 10, source: 'local' }]);
  });

  it('stay silent when removing a key that was not there', () => {
    const basket = createLocalStorage('basket');
    const listener = vi.fn();
    basket.subscribe('count', listener);
    basket.remove('count');
    expect(listener).not.toHaveBeenCalled();
  });

  it('do not fire for other keys in the namespace', () => {
    const basket = createLocalStorage('basket');
    const listener = vi.fn();
    basket.subscribe('count', listener);
    basket.set('items', [1]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('reach a subscriber watching the whole namespace', () => {
    const basket = createLocalStorage('basket');
    const seen: ChangeEvent[] = [];
    basket.subscribe((event) => seen.push(event));

    basket.set('count', 1);
    basket.set('items', ['a']);

    expect(seen.map((e) => e.key)).toEqual(['count', 'items']);
    expect(seen[1]?.newValue).toEqual(['a']);
  });

  it('fire once per key when the namespace is cleared', () => {
    const basket = createLocalStorage('basket');
    basket.set('a', 1);
    basket.set('b', 2);
    const seen: ChangeEvent[] = [];
    basket.subscribe((event) => seen.push(event));

    basket.clear();

    expect(seen.map((e) => e.key).sort()).toEqual(['a', 'b']);
    expect(seen.every((e) => e.newValue === undefined)).toBe(true);
    expect(seen.map((e) => e.oldValue).sort()).toEqual([1, 2]);
  });

  it('carry values through the codec', () => {
    const basket = createLocalStorage('basket');
    const seen: ChangeEvent[] = [];
    basket.subscribe('when', (event) => seen.push(event));

    basket.set('when', new Date(1000));

    expect(seen[0]?.newValue).toBeInstanceOf(Date);
    expect((seen[0]?.newValue as Date).getTime()).toBe(1000);
  });
});

describe('changes from another tab', () => {
  it('are decoded and marked remote', () => {
    const basket = createLocalStorage('basket');
    const seen: ChangeEvent[] = [];
    basket.subscribe('count', (event) => seen.push(event));

    fromAnotherTab('basket:count', '11', '10');

    expect(seen).toEqual([{ key: 'count', newValue: 11, oldValue: 10, source: 'remote' }]);
  });

  it('ignore keys belonging to another namespace', () => {
    const basket = createLocalStorage('basket');
    const listener = vi.fn();
    basket.subscribe(listener);

    fromAnotherTab('auth:token', '"abc"');
    fromAnotherTab('unprefixed', '1');
    fromAnotherTab('basketball:count', '1');

    expect(listener).not.toHaveBeenCalled();
  });

  it('ignore the reserved internal keys', () => {
    const basket = createLocalStorage('basket');
    const listener = vi.fn();
    basket.subscribe(listener);
    fromAnotherTab('basket:__nss:meta', '{"version":2}');
    expect(listener).not.toHaveBeenCalled();
  });

  it('do not cross between localStorage and sessionStorage', () => {
    const local = createLocalStorage('ns');
    const session = createSessionStorage('ns');
    const onLocal = vi.fn();
    const onSession = vi.fn();
    local.subscribe(onLocal);
    session.subscribe(onSession);

    fromAnotherTab('ns:k', '1', null, localStorage);

    expect(onLocal).toHaveBeenCalledOnce();
    expect(onSession).not.toHaveBeenCalled();
  });

  it('tell a whole-namespace subscriber when the area was cleared', () => {
    const basket = createLocalStorage('basket');
    const seen: ChangeEvent[] = [];
    basket.subscribe((event) => seen.push(event));

    fromAnotherTab(null, null);

    expect(seen).toEqual([
      { key: null, newValue: undefined, oldValue: undefined, source: 'remote' },
    ]);
  });

  it('tell a per-key subscriber about its own key instead of a null', () => {
    const basket = createLocalStorage('basket');
    const seen: ChangeEvent[] = [];
    basket.subscribe('count', (event) => seen.push(event));

    fromAnotherTab(null, null);

    expect(seen).toEqual([
      { key: 'count', newValue: undefined, oldValue: undefined, source: 'remote' },
    ]);
  });

  it('survive a value that cannot be decoded, reporting instead of throwing', () => {
    const onError = vi.fn();
    const basket = createLocalStorage('basket', { onError });
    const seen: ChangeEvent[] = [];
    basket.subscribe('count', (event) => seen.push(event));

    expect(() => fromAnotherTab('basket:count', '{oops')).not.toThrow();

    expect(seen).toEqual([
      { key: 'count', newValue: undefined, oldValue: undefined, source: 'remote' },
    ]);
    expect(onError).toHaveBeenCalled();
  });

  it('report a value that fails the schema without delivering it', () => {
    const onError = vi.fn();
    const basket = createLocalStorage('basket', { schema: { count: t.number() }, onError });
    const seen: ChangeEvent[] = [];
    basket.subscribe('count', (event) => seen.push(event));

    fromAnotherTab('basket:count', '"ten"');

    expect(seen[0]?.newValue).toBeUndefined();
    expect(onError).toHaveBeenCalled();
  });
});

describe('unsubscribing', () => {
  it('stops delivery', () => {
    const basket = createLocalStorage('basket');
    const listener = vi.fn();
    const off = basket.subscribe('count', listener);

    basket.set('count', 1);
    off();
    basket.set('count', 2);

    expect(listener).toHaveBeenCalledOnce();
  });

  it('leaves other subscribers alone', () => {
    const basket = createLocalStorage('basket');
    const a = vi.fn();
    const b = vi.fn();
    const offA = basket.subscribe('count', a);
    basket.subscribe('count', b);

    offA();
    basket.set('count', 1);

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
  });

  it('detaches the window listener once the last subscriber goes', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    try {
      const basket = createLocalStorage('basket');
      const offA = basket.subscribe('a', vi.fn());
      const offB = basket.subscribe('b', vi.fn());

      // One native listener serves every subscriber on the adapter.
      expect(add.mock.calls.filter(([type]) => type === 'storage')).toHaveLength(1);

      offA();
      expect(remove.mock.calls.filter(([type]) => type === 'storage')).toHaveLength(0);
      offB();
      expect(remove.mock.calls.filter(([type]) => type === 'storage')).toHaveLength(1);
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
  });

  it('is safe to call twice', () => {
    const basket = createLocalStorage('basket');
    const off = basket.subscribe('count', vi.fn());
    off();
    expect(() => off()).not.toThrow();
  });

  it('lets a subscriber unsubscribe from inside its own callback', () => {
    const basket = createLocalStorage('basket');
    const other = vi.fn();
    const off = basket.subscribe('count', () => off());
    basket.subscribe('count', other);

    expect(() => basket.set('count', 1)).not.toThrow();
    expect(other).toHaveBeenCalledOnce();
  });
});

describe('a subscriber that throws', () => {
  it('is reported, and does not stop the others or the write', () => {
    const onError = vi.fn();
    const basket = createLocalStorage('basket', { onError });
    const healthy = vi.fn();

    basket.subscribe('count', () => {
      throw new Error('subscriber blew up');
    });
    basket.subscribe('count', healthy);

    expect(() => basket.set('count', 1)).not.toThrow();
    expect(healthy).toHaveBeenCalledOnce();
    expect(basket.get('count')).toBe(1);
    expect(onError.mock.calls.some(([e]) => e instanceof SubscriberError)).toBe(true);
  });

  it('does not escape into the browser event loop on a remote change', () => {
    const basket = createLocalStorage('basket', { onError: vi.fn() });
    basket.subscribe('count', () => {
      throw new Error('subscriber blew up');
    });
    expect(() => fromAnotherTab('basket:count', '1')).not.toThrow();
  });
});

describe('scope', () => {
  it('a child sees only its own keys', () => {
    const basket = createLocalStorage('basket');
    const ui = basket.child('ui');
    const onChild = vi.fn();
    ui.subscribe(onChild);

    basket.set('count', 1);
    expect(onChild).not.toHaveBeenCalled();

    ui.set('collapsed', true);
    expect(onChild).toHaveBeenCalledOnce();
    expect(onChild.mock.calls[0]?.[0]).toMatchObject({ key: 'collapsed', newValue: true });
  });

  it('a parent also sees changes made through a child', () => {
    const basket = createLocalStorage('basket');
    const seen: ChangeEvent[] = [];
    basket.subscribe((event) => seen.push(event));

    basket.child('ui').set('collapsed', true);

    expect(seen.map((e) => e.key)).toEqual(['ui:collapsed']);
  });

  it('two stores over the same namespace observe each other', () => {
    const a = createMemoryStorage('shared');
    const b = createMemoryStorage('shared');
    const listener = vi.fn();
    a.subscribe('k', listener);
    b.set('k', 42);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0]?.[0]).toMatchObject({ newValue: 42 });
  });

  it('never fires on an adapter that cannot observe', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });
    try {
      const store = createLocalStorage('s', { fallback: 'noop' });
      const off = store.subscribe(vi.fn());
      store.set('k', 1);
      expect(() => off()).not.toThrow();
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
    }
  });
});

describe('types', () => {
  it('narrow the event value to the key it watches', () => {
    const assertions = () => {
      const basket = createMemoryStorage('basket', {
        defaults: { count: 0, items: [] as string[] },
      });

      basket.subscribe('count', (event) => {
        expectTypeOf(event.newValue).toEqualTypeOf<number | undefined>();
        expectTypeOf(event.oldValue).toEqualTypeOf<number | undefined>();
        expectTypeOf(event.source).toEqualTypeOf<'local' | 'remote'>();
      });

      basket.subscribe((event) => {
        expectTypeOf(event.newValue).toEqualTypeOf<number | string[] | undefined>();
      });

      // @ts-expect-error - 'nope' is not a declared key
      basket.subscribe('nope', () => {});
    };
    expect(assertions).toBeTypeOf('function');
  });
});

describe('runtimes with a localStorage polyfill but no event target', () => {
  it('still works, and subscribing is simply inert', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const originalAdd = Object.getOwnPropertyDescriptor(globalThis, 'addEventListener');
    const backing = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        get length() {
          return backing.size;
        },
        getItem: (k: string) => backing.get(k) ?? null,
        setItem: (k: string, v: string) => void backing.set(k, v),
        removeItem: (k: string) => void backing.delete(k),
        key: (i: number) => [...backing.keys()][i] ?? null,
        clear: () => backing.clear(),
      },
    });
    // React Native and node-localstorage give you storage without a window to listen on.
    Object.defineProperty(globalThis, 'addEventListener', {
      configurable: true,
      value: undefined,
    });

    try {
      const store = createLocalStorage('s');
      expect(store.available).toBe(true);

      const seen: ChangeEvent[] = [];
      const off = store.subscribe('k', (event) => seen.push(event));

      // Local writes are still observable; only the cross-tab half is missing.
      store.set('k', 1);
      expect(seen).toHaveLength(1);
      expect(() => off()).not.toThrow();
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      if (originalAdd) Object.defineProperty(globalThis, 'addEventListener', originalAdd);
    }
  });
});

describe('the memory backend emits too', () => {
  it('reports writes and removals', () => {
    const store = createMemoryStorage('m');
    const seen: ChangeEvent[] = [];
    store.subscribe((event) => seen.push(event));

    store.set('k', 1);
    store.remove('k');
    store.remove('k'); // already gone — nothing to report

    expect(seen).toEqual([
      { key: 'k', newValue: 1, oldValue: undefined, source: 'local' },
      { key: 'k', newValue: undefined, oldValue: 1, source: 'local' },
    ]);
  });
});
