[![npm version](https://img.shields.io/npm/v/namespaced-storage.svg)](https://www.npmjs.com/package/namespaced-storage)
[![license](https://img.shields.io/npm/l/namespaced-storage.svg)](LICENSE)
[![types](https://img.shields.io/npm/types/namespaced-storage.svg)](https://www.npmjs.com/package/namespaced-storage)

# namespaced-storage

Namespaced, type-safe, SSR-safe `localStorage` / `sessionStorage`. Zero dependencies.

```ts
import { createLocalStorage } from 'namespaced-storage';

const basket = createLocalStorage('basket');

basket.set('count', 10); // writes "basket:count"
basket.get('count'); // 10 — parsed back, not a string
basket.clear(); // clears basket:* only
```

## Why

Raw storage is one global namespace: two features can write the same key, `clear()` wipes
everything, and every value is hand-`JSON.parse`d — or crashes when it isn't.

|                | raw storage            | namespaced-storage            |
| -------------- | ---------------------- | ----------------------------- |
| key collisions | silent overwrite       | impossible between namespaces |
| `clear()`      | wipes the whole origin | wipes one namespace           |
| values         | strings only           | any JSON value, round-tripped |
| SSR / no DOM   | throws                 | falls back to memory          |
| quota exceeded | raw `DOMException`     | typed error, or `trySet()`    |
| corrupt data   | throws mid-render      | reads as `undefined`          |

> Discipline, not security — `localStorage.setItem('basket:count', …)` still works. This removes
> _accidental_ collisions, _accidental_ `clear()`, and silent type drift.

## Install

```bash
npm install namespaced-storage
```

6.4 kB min+brotli · **5.2 kB** from `namespaced-storage/minimal` · zero runtime deps · ESM + CJS ·
types included

## Usage

### Namespacing

```ts
const basket = createLocalStorage('basket');
const auth = createSessionStorage('auth');

basket.set('token', 'a');
auth.set('token', 'b'); // different key, no collision
```

Declare each store in a `*.storage.ts` file next to the feature that owns it — there's no central
registry to keep in sync.

```ts
createLocalStorage('basket'); // localStorage — survives a restart
createSessionStorage('auth'); // sessionStorage — dies with the tab
createMemoryStorage('fixture'); // in-memory — tests, Node, SSR
```

### Values

```ts
basket.set('items', [{ id: 'sku-1', qty: 2 }]);
basket.get('items'); // [{ id: 'sku-1', qty: 2 }]
basket.set('count', undefined); // same as remove('count')
```

Values round-trip through plain JSON, plus `Date`, `Map`, `Set`, `BigInt`, `RegExp`, `NaN` and
`±Infinity` at any depth — only the keys that need it pay for the extra bytes.

```ts
basket.set('updatedAt', new Date());
basket.get('updatedAt'); // a real Date back
```

### Typed keys and values

```ts
export const basket = createLocalStorage('basket', {
  defaults: { count: 0, items: [] as BasketItem[] },
});

basket.get('count'); // number — not number | undefined
basket.set('count', 'ten'); // ✗ compile error
```

`defaults` is a plain object — no DSL, no schema required. For keys with no sensible default, or
data that needs validation, use `schema` — the built-in `t.*`, or any
[Standard Schema](https://standardschema.dev) validator (Zod, Valibot, ArkType):

```ts
export const auth = createSessionStorage('auth', {
  schema: { token: t.string() },
});

auth.set('token', 42); // ✗ compile error, throws ValidationError at runtime
```

### Expiry

```ts
auth.set('token', jwt, { ttl: 15 * 60_000 }); // 15 minutes
auth.ttl('token'); // ms remaining, or null
auth.get('token'); // undefined once expired — checked on access, no timer
```

<details>
<summary><b>Timestamps</b></summary>

```ts
const store = createLocalStorage('s', { timestamps: true });
store.set('count', 1);
store.meta('count'); // { createdAt, updatedAt }
```

</details>

<details>
<summary><b>Migrations</b></summary>

```ts
export const basket = createLocalStorage('basket', {
  defaults: { items: [] as Item[], total: 0 },
  version: 2,
  migrate: (previous, fromVersion) => {
    if (fromVersion < 2) {
      const items = (previous.cart as Item[]) ?? [];
      return { items, total: items.length };
    }
    return previous;
  },
});
```

Runs once, before the first read. A migration that throws leaves the version untouched, so the
next load retries — write migrations that tolerate being run twice.

</details>

<details>
<summary><b>Duplicate-namespace detection</b></summary>

```
NamespaceConflictError: Namespace "basket" is already registered on localStorage.
  first:  src/features/basket/basket.storage.ts:6:24
  second: src/legacy/cart/store.ts:11:18
```

Throws outside production, reports via `onError` inside it. Pass `{ strict: false }` if two
instances are intentional, and call `resetNamespaceRegistry()` in test setup.

</details>

<details>
<summary><b>Reacting to changes</b></summary>

```ts
const off = basket.subscribe('count', (event) => {
  event.newValue; // undefined means removed
  event.source; // 'local' in this tab, 'remote' from another
});
off();
```

Covers both tabs — the native `storage` event only fires in others.

</details>

<details>
<summary><b>Devtools</b></summary>

```ts
basket.inspect(); // console.table of the namespace
basket.export(); // plain snapshot — the values get() returns
```

In development, every store also registers on `window.__NAMESPACED_STORAGE__`.

</details>

<details>
<summary><b>Minimal build</b></summary>

```ts
import { createLocalStorage } from 'namespaced-storage/minimal';
```

Keeps namespacing, codecs, TTL, timestamps, events, `child()`, `inspect()`, `export()`. Drops
`defaults`, `schema`, `version`, `migrate` — and throws if you pass one, naming the entry point
that supports it.

</details>

<details>
<summary><b>Testing</b></summary>

```ts
beforeEach(() => {
  localStorage.clear();
  resetNamespaceRegistry(); // otherwise the conflict guard fires on the 2nd test
  resetMemoryAdapters(); // only if you use createMemoryStorage
});
```

`createMemoryStorage` needs no DOM at all.

</details>

<details>
<summary><b>React</b></summary>

```ts
function useStored<T>(store: Store, key: string, serverValue: T): T {
  const cache = useRef<{ raw: unknown; value: T }>();
  return useSyncExternalStore(
    useCallback((onChange) => store.subscribe(key, onChange), [store, key]),
    () => {
      const raw = store.getItem(key);
      if (cache.current?.raw !== raw) cache.current = { raw, value: store.get(key) };
      return cache.current.value;
    },
    () => serverValue, // server snapshot — storage doesn't exist there
  );
}
```

`get()` decodes a fresh object on every call, so the snapshot needs caching or React re-renders
forever. Skip the cache for primitives (`number`, `string`, `boolean`) — `Object.is` already holds.

</details>

<details>
<summary><b>Nested namespaces</b></summary>

```ts
const ui = basket.child('ui');
ui.set('collapsed', true); // writes "basket:ui:collapsed"
basket.clear(); // clears the child too
```

</details>

<details>
<summary><b>Fallbacks and corrupt data</b></summary>

```ts
const basket = createLocalStorage('basket', {
  fallback: 'memory', // 'memory' (default) | 'throw' | 'noop'
  onCorrupt: 'remove', // unparseable value: 'ignore' (default) | 'remove' | 'throw'
  onError: (error) => report(error),
});

basket.available; // false under SSR, private mode, or a blocked iframe

const result = basket.trySet('items', huge);
if (!result.ok) showToast('Could not save'); // result.error is a StorageQuotaError
```

</details>

## API

|                                       |                                                                   |
| ------------------------------------- | ----------------------------------------------------------------- |
| `set(key, value, { ttl? })`           | writes; `undefined` removes. Throws `StorageQuotaError` when full |
| `get<T>(key)`                         | `T \| undefined`, or `T` when the key has a default               |
| `remove(key)` · `has(key)`            |                                                                   |
| `clear()`                             | this namespace only                                               |
| `keys()` · `entries()` · `size`       | namespace-relative, internal keys hidden                          |
| `subscribe(key?, listener)`           | returns an unsubscribe function                                   |
| `meta(key)` · `ttl(key)`              | timestamps, and ms remaining before expiry                        |
| `trySet(key, value)`                  | `{ ok: true } \| { ok: false, error }`                            |
| `child(segment)`                      | a nested namespace, untyped                                       |
| `inspect()` · `export()`              | `console.table`, or a plain snapshot                              |
| `namespace` · `adapter` · `available` |                                                                   |

<details>
<summary>Options</summary>

| option                  | default    |                                                                      |
| ----------------------- | ---------- | -------------------------------------------------------------------- |
| `defaults`              | —          | plain object; declares the keys, their types and fallbacks           |
| `schema`                | —          | `t.*` or any Standard Schema validator, per key                      |
| `fallback`              | `'memory'` | `'memory'` · `'throw'` · `'noop'`                                    |
| `onCorrupt`             | `'ignore'` | unparseable value: `'ignore'` · `'remove'` · `'throw'`               |
| `onInvalid`             | `'ignore'` | value fails its schema: `'ignore'` · `'remove'` · `'throw'`          |
| `version` · `migrate`   | —          | the shape this build expects, and how to get there from an older one |
| `ttl` · `timestamps`    | —          | default lifetime per key; whether to record `createdAt`/`updatedAt`  |
| `strict`                | —          | conflict guard; throws outside production, reports inside it         |
| `onError`               | —          | called for every error, including ones that are not thrown           |
| `prefix` · `separator`  | — · `':'`  | app-wide prefix, and the character joining segments                  |
| `owner` · `description` | —          | metadata for the `nss` inventory; unused at runtime                  |

</details>

## Errors

Every error extends `NamespacedStorageError` and carries a stable `.code`, `.namespace` and `.key`.
Full list and when each fires: [docs/errors.md](../../docs/errors.md).

## Constraints

- Namespace and child segments match `/^[A-Za-z0-9_.-]+$/`. Keys are unconstrained.
- Keys starting with `__nss` are reserved.
- ES2020 · Node ≥18 · evergreen browsers.

## Docs

- [Errors](../../docs/errors.md) · [Migrating from raw storage](../../docs/migrating-from-raw-storage.md) ·
  [llms.txt](../../docs/llms.txt) · [all documentation](../../docs)
- [The AI skill](skill/SKILL.md) — ships under `skill/`; copy it into
  `.claude/skills/` and your assistant stops inventing an API.
- Examples: [vanilla TypeScript](../../examples/vanilla-ts) · [React](../../examples/react) ·
  [Next.js and SSR](../../examples/next-ssr)

## Status

`1.0.0` — 307 tests, 99.8% line coverage, clean on `publint` and `@arethetypeswrong/cli`. The API,
options and on-disk format are stable; changing any of them is a major version.

Ships with two companions: [`eslint-plugin-namespaced-storage`](../eslint-plugin) (bans raw
`localStorage`, requires literal namespaces) and [`nss`](../cli) (scans your source for an
inventory of what the app stores). Planned for a later release: a docs site, and an async core for
IndexedDB and Redis.

## License

MIT
