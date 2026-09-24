import { describe, expect, it } from 'vitest';
import { findDuplicates, scanSource } from '../src/scan.js';

const imported = "import { createLocalStorage, createSessionStorage } from 'namespaced-storage';\n";

const one = (source: string, file = 'src/basket.storage.ts') => {
  const result = scanSource(file, imported + source);
  return result.declarations[0];
};

describe('finding declarations', () => {
  it('reads the namespace, the backend and where it was declared', () => {
    const found = one("export const basket = createLocalStorage('basket');");

    expect(found?.namespace).toBe('basket');
    expect(found?.backend).toBe('local');
    expect(found?.file).toBe('src/basket.storage.ts');
    expect(found?.line).toBe(2);
  });

  it('tells the backends apart', () => {
    const { declarations } = scanSource(
      'a.ts',
      "import { createLocalStorage, createSessionStorage, createMemoryStorage } from 'namespaced-storage';\n" +
        "createLocalStorage('a'); createSessionStorage('b'); createMemoryStorage('c');",
    );

    expect(declarations.map((d) => d.backend)).toEqual(['local', 'session', 'memory']);
  });

  it('follows a renamed import and a namespace import', () => {
    const renamed = scanSource(
      'a.ts',
      "import { createLocalStorage as make } from 'namespaced-storage';\nmake('basket');",
    );
    const starred = scanSource(
      'b.ts',
      "import * as nss from 'namespaced-storage';\nnss.createSessionStorage('auth');",
    );

    expect(renamed.declarations[0]?.namespace).toBe('basket');
    expect(starred.declarations[0]?.namespace).toBe('auth');
  });

  it('counts the minimal entry point as the same package', () => {
    const { declarations } = scanSource(
      'a.ts',
      "import { createLocalStorage } from 'namespaced-storage/minimal';\ncreateLocalStorage('ui');",
    );

    expect(declarations[0]?.namespace).toBe('ui');
  });

  it('ignores a same-named function from somewhere else', () => {
    const { declarations } = scanSource(
      'a.ts',
      "import { createLocalStorage } from './my-helpers.js';\ncreateLocalStorage('basket');",
    );

    expect(declarations).toEqual([]);
  });

  it('reports a namespace it cannot read rather than skipping it silently', () => {
    const { declarations, problems } = scanSource('a.ts', `${imported}createLocalStorage(name);`);

    expect(declarations).toEqual([]);
    expect(problems[0]?.kind).toBe('dynamic-namespace');
    expect(problems[0]?.sites[0]).toBe('a.ts:2:1');
  });
});

describe('reading the options', () => {
  it('picks up owner, description and version', () => {
    const found = one(`createLocalStorage('basket', {
      owner: 'team-checkout',
      description: 'Shopping basket, survives reload',
      version: 3,
    });`);

    expect(found?.owner).toBe('team-checkout');
    expect(found?.description).toBe('Shopping basket, survives reload');
    expect(found?.version).toBe(3);
  });

  it('works out a ttl written the way the README writes it', () => {
    expect(one("createLocalStorage('a', { ttl: 15 * 60_000 });")?.ttl).toBe(900_000);
    expect(one("createLocalStorage('a', { ttl: 1000 });")?.ttl).toBe(1000);
    expect(one("createLocalStorage('a', { ttl: someConstant });")?.ttl).toBeUndefined();
  });

  it('leaves out what was never declared', () => {
    const found = one("createLocalStorage('basket');");

    expect(found?.owner).toBeUndefined();
    expect(found?.keys).toEqual([]);
  });
});

describe('reading the keys', () => {
  it('types them from the defaults', () => {
    const found = one(`createLocalStorage('basket', {
      defaults: { count: 0, name: 'x', open: false, items: [], state: {}, at: new Date() },
    });`);

    expect(found?.keys).toEqual([
      { name: 'count', type: 'number', source: 'defaults' },
      { name: 'name', type: 'string', source: 'defaults' },
      { name: 'open', type: 'boolean', source: 'defaults' },
      { name: 'items', type: 'array', source: 'defaults' },
      { name: 'state', type: 'object', source: 'defaults' },
      { name: 'at', type: 'Date', source: 'defaults' },
    ]);
  });

  it('prefers the annotation a developer wrote over the literal it applies to', () => {
    const found = one(`createLocalStorage('basket', {
      defaults: { items: [] as BasketItem[] },
    });`);

    expect(found?.keys[0]?.type).toBe('BasketItem[]');
  });

  it('reads the t.* builders, including what they wrap', () => {
    const found = one(`createSessionStorage('auth', {
      schema: {
        token: t.string(),
        refreshAt: t.date(),
        scopes: t.array(t.string()).optional(),
        mode: t.enum(['light', 'dark']),
        lookup: t.record(t.number()),
        maybe: t.boolean().nullable(),
      },
    });`);

    expect(Object.fromEntries(found?.keys.map((k) => [k.name, k.type]) ?? [])).toEqual({
      token: 'string',
      refreshAt: 'Date',
      scopes: 'string[] | undefined',
      mode: "'light' | 'dark'",
      lookup: 'Record<string, number>',
      maybe: 'boolean | null',
    });
  });

  it('says when a key is declared in both places, and lets the schema name it', () => {
    const found = one(`createLocalStorage('ui', {
      defaults: { mode: 'light' },
      schema: { mode: t.enum(['light', 'dark']) },
    });`);

    expect(found?.keys).toEqual([{ name: 'mode', type: "'light' | 'dark'", source: 'both' }]);
  });

  it('survives a schema it does not recognise', () => {
    const found = one("createLocalStorage('a', { schema: { token: z.string().min(10) } });");

    expect(found?.keys[0]).toEqual({ name: 'token', type: 'string', source: 'schema' });
  });
});

describe('duplicates', () => {
  const at = (namespace: string, file: string, backend: 'local' | 'session' = 'local') => ({
    namespace,
    backend,
    owner: undefined,
    description: undefined,
    keys: [],
    ttl: undefined,
    version: undefined,
    file,
    line: 1,
    column: 1,
  });

  it('names both sites', () => {
    const problems = findDuplicates([
      at('cart', 'src/basket.storage.ts'),
      at('cart', 'src/legacy.ts'),
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]?.sites).toEqual(['src/basket.storage.ts:1:1', 'src/legacy.ts:1:1']);
  });

  it('lets local and session each hold a namespace of the same name', () => {
    expect(findDuplicates([at('auth', 'a.ts'), at('auth', 'b.ts', 'session')])).toEqual([]);
  });

  it('says nothing when every namespace is claimed once', () => {
    expect(findDuplicates([at('a', 'a.ts'), at('b', 'b.ts')])).toEqual([]);
  });
});
