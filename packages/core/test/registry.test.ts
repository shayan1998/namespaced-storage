import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLocalStorage,
  createMemoryStorage,
  createSessionStorage,
} from '../src/store/create.js';
import { resetMemoryAdapters } from '../src/adapters/memory.js';
import { resetNamespaceRegistry } from '../src/namespace/registry.js';
import { InvalidOptionsError, NamespaceConflictError } from '../src/errors.js';
import { t } from '../src/typing/t.js';

beforeEach(() => {
  resetNamespaceRegistry();
  resetMemoryAdapters();
  localStorage.clear();
  sessionStorage.clear();
});

/** Pretends the bundle is running in a production build. */
function asProduction(run: () => void): void {
  const host = globalThis as { process?: { env?: Record<string, string | undefined> } };
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'process');
  const original = host.process;
  Object.defineProperty(globalThis, 'process', {
    configurable: true,
    value: { env: { NODE_ENV: 'production' } },
  });
  try {
    run();
  } finally {
    if (had) Object.defineProperty(globalThis, 'process', { configurable: true, value: original });
    else delete host.process;
  }
}

describe('a second instance of the same namespace', () => {
  it('throws, naming both call sites', () => {
    createLocalStorage('basket');

    let thrown: unknown;
    try {
      createLocalStorage('basket');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(NamespaceConflictError);
    const error = thrown as NamespaceConflictError;
    expect(error.code).toBe('NAMESPACE_CONFLICT');
    expect(error.namespace).toBe('basket');
    expect(error.message).toContain('first:');
    expect(error.message).toContain('second:');
    // The two sites must actually differ, or the message says nothing useful.
    const [, first, second] = /first:\s+(\S+)[\s\S]*second:\s+(\S+)/.exec(error.message) ?? [];
    expect(first).toBeDefined();
    expect(first).not.toBe(second);
    expect(first).toContain('registry.test.ts');
  });

  it('is reported through onError as well as thrown', () => {
    const onError = vi.fn();
    createLocalStorage('basket');
    expect(() => createLocalStorage('basket', { onError })).toThrow(NamespaceConflictError);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(NamespaceConflictError);
  });

  it('is allowed outright with strict: false', () => {
    createLocalStorage('basket');
    expect(() => createLocalStorage('basket', { strict: false })).not.toThrow();
  });

  it('can be forced to throw even in production with strict: true', () => {
    asProduction(() => {
      createLocalStorage('basket');
      expect(() => createLocalStorage('basket', { strict: true })).toThrow(NamespaceConflictError);
    });
  });
});

describe('what counts as the same namespace', () => {
  it('localStorage and sessionStorage may each hold one of the same name', () => {
    expect(() => {
      createLocalStorage('auth');
      createSessionStorage('auth');
    }).not.toThrow();
  });

  it('a prefix makes it a different namespace', () => {
    expect(() => {
      createLocalStorage('basket');
      createLocalStorage('basket', { prefix: 'myapp' });
    }).not.toThrow();
  });

  it('a memory fallback does not change the identity of the namespace', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });
    try {
      // Both fall back to memory, but they still asked for localStorage.
      createLocalStorage('basket');
      expect(() => createLocalStorage('basket')).toThrow(NamespaceConflictError);
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
    }
  });

  it('children are not registered, so nesting freely is fine', () => {
    const basket = createLocalStorage('basket');
    expect(() => {
      basket.child('ui');
      basket.child('ui');
      basket.child('ui').child('deep');
    }).not.toThrow();
  });
});

describe('module re-evaluation', () => {
  it('is silent when the same line runs twice, so hot reload is not broken', () => {
    // A hot reload re-runs the module body: the same call, at the same file and line.
    const create = (): unknown => createMemoryStorage('hmr');
    expect(() => {
      create();
      create();
      create();
    }).not.toThrow();
  });

  it('still catches two different lines creating the same namespace', () => {
    const fromHere = (): unknown => createMemoryStorage('dup');
    const fromThere = (): unknown => createMemoryStorage('dup');
    fromHere();
    expect(() => fromThere()).toThrow(NamespaceConflictError);
  });
});

describe('in a production build', () => {
  it('reports the conflict but does not take the page down', () => {
    asProduction(() => {
      const onError = vi.fn();
      createLocalStorage('basket');
      expect(() => createLocalStorage('basket', { onError })).not.toThrow();
      expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(NamespaceConflictError);
    });
  });
});

describe('ordering against other failures', () => {
  it('reports a malformed option rather than the conflict it tripped over', () => {
    createMemoryStorage('s');
    // The namespace is already taken *and* the ttl is nonsense; the local mistake wins.
    expect(() => createMemoryStorage('s', { ttl: 0 })).toThrow(InvalidOptionsError);
  });

  it('reports a default that contradicts its schema rather than the conflict', () => {
    createMemoryStorage('s');
    expect(() =>
      createMemoryStorage('s', { defaults: { n: 'x' }, schema: { n: t.number() } }),
    ).toThrow(InvalidOptionsError);
  });

  it('reports an invalid namespace before anything else', () => {
    expect(() => createMemoryStorage('bad:name')).toThrow(/outside \[A-Za-z0-9_\.-\]/);
  });
});

describe('the registry survives a second copy of the package', () => {
  it('lives on globalThis under a shared symbol', () => {
    createLocalStorage('basket');
    const shared = (globalThis as Record<symbol, Map<string, unknown> | undefined>)[
      Symbol.for('namespaced-storage.registry')
    ];
    expect(shared).toBeInstanceOf(Map);
    expect(shared?.has('localStorage::basket')).toBe(true);
  });
});

describe('when the engine will not give us a stack', () => {
  it('fails loud rather than silent, and says the location is unknown', () => {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 0;
    try {
      // Two calls that cannot be told apart must still be reported. Treating an unknown site
      // as a match would make the guard quietly inert, which is the one failure to avoid.
      createMemoryStorage('blind');
      expect(() => createMemoryStorage('blind')).toThrow(/unknown location/);
    } finally {
      Error.stackTraceLimit = limit;
    }
  });
});

afterEach(() => resetNamespaceRegistry());
