# namespaced-storage

Namespaced, SSR-safe, zero-dependency wrapper over `localStorage` and `sessionStorage`.

In a long-lived codebase, browser storage is a global mutable namespace with no owner and no
schema. Team A writes `token`; team B overwrites it. Somebody calls `localStorage.clear()` and takes
out everyone's data. Nobody can say what the app persists without grepping for `setItem`.

```ts
import { createLocalStorage } from 'namespaced-storage';

export const basket = createLocalStorage('basket');

basket.set('count', 10); // writes the key "basket:count"
basket.get('count'); // 10 — parsed back, not a string
basket.clear(); // clears basket:* and nothing else
```

> **Discipline, not security.** Any code can construct a second instance of the same namespace, and
> raw `localStorage.setItem('basket:count', …)` always works. What this removes is _accidental_
> collision, _accidental_ `clear()`, and silent type drift.

## Install

```bash
npm install namespaced-storage
```

## Why

|                               | raw storage                       | namespaced-storage                           |
| ----------------------------- | --------------------------------- | -------------------------------------------- |
| key collisions                | silent overwrite                  | impossible between namespaces                |
| `clear()`                     | wipes the whole origin            | wipes one namespace                          |
| values                        | strings only, manual `JSON.parse` | any JSON value, round-tripped                |
| SSR                           | `localStorage is not defined`     | works, falls back to memory                  |
| private mode / blocked iframe | throws                            | works, falls back to memory                  |
| quota exceeded                | raw `DOMException`                | typed `StorageQuotaError`, or `trySet()`     |
| corrupt value                 | `JSON.parse` throws mid-render    | reads as `undefined`, reported via `onError` |

## Usage

### Namespacing

```ts
const basket = createLocalStorage('basket');
const auth = createSessionStorage('auth');

basket.set('token', 'a');
auth.set('token', 'b'); // different key, no collision
```

Declare each store in a `*.storage.ts` file next to the feature that owns it, and export it. There
is no central registry file to keep in sync.

### Values

JSON-native values are stored exactly as `JSON.stringify` would write them, so existing raw data
stays readable and anything else that reads the key still works.

```ts
basket.set('items', [{ id: 'sku-1', qty: 2 }]);
basket.get('items'); // [{ id: 'sku-1', qty: 2 }]
basket.get<number>('count');

basket.set('count', undefined); // same as remove('count')
```

```js
// what is actually in localStorage
'basket:items'; // [{"id":"sku-1","qty":2}]   ← plain, exactly as before
```

Types JSON cannot represent survive too — at any depth, not just the top level:

```ts
basket.set('state', {
  updatedAt: new Date(),
  tags: new Set(['sale']),
  byId: new Map([['sku-1', { addedAt: new Date() }]]),
  ratio: Infinity,
});

const state = basket.get('state');
state.updatedAt; // a real Date
state.byId.get('sku-1').addedAt; // a real Date, two levels down
state.ratio; // Infinity — JSON.stringify would have made this null
```

Supported: `Date`, `Map`, `Set`, `BigInt`, `RegExp`, `NaN`, `±Infinity`, and nested `undefined`
(which plain JSON drops). Only keys that need it pay for the extra bytes — everything else stays on
the plain path.

### Typed keys and values

Pass a plain `defaults` object. Types come from it, and so does the fallback when a key has never
been written:

```ts
export const basket = createLocalStorage('basket', {
  defaults: { count: 0, items: [] as BasketItem[], lastOpened: new Date() },
});

basket.get('count'); // number — not number | undefined, it has a default
basket.get('lastOpened'); // Date
basket.set('count', 'ten'); // ✗ compile error
basket.set('cout', 1); // ✗ compile error — key typo caught
```

There is no DSL to learn: `defaults` is an ordinary object, and the types are `typeof defaults`.
Each read returns a **clone**, so mutating what you got back cannot corrupt the fallback.

For keys with no sensible default, or data that must be validated, use `schema`:

```ts
import { createSessionStorage, t } from 'namespaced-storage';

export const auth = createSessionStorage('auth', {
  schema: { token: t.string(), scopes: t.array(t.string()).optional() },
});

auth.get('token'); // string | undefined
auth.set('token', 42); // ✗ compile error, and would throw ValidationError at runtime
```

Any [Standard Schema](https://standardschema.dev) validator works instead — Zod 3.24+, Valibot,
ArkType, Effect Schema — with **no peer dependency** and nothing extra in your bundle if you skip it:

```ts
schema: {
  token: z.string().min(10);
}
```

`defaults` and `schema` can declare the same key: the schema validates, the default is the
fallback. A default that contradicts its own schema is rejected at construction.

```ts
const ui = createLocalStorage('ui', {
  defaults: { mode: 'light' },
  schema: { mode: t.enum(['light', 'dark']) },
});
ui.get('mode'); // 'light' | 'dark'
```

Writes always validate and throw `ValidationError`. Reads follow `onInvalid`
(`'ignore'` by default, falling back to the default value) so stale data never crashes a render.

Built in: `t.string` `t.number` `t.boolean` `t.bigint` `t.date` `t.literal` `t.enum` `t.array`
`t.object` `t.record` `t.union` `t.unknown`, each with `.optional()` and `.nullable()`.

### Expiry

```ts
auth.set('token', jwt, { ttl: 15 * 60_000 }); // 15 minutes
auth.ttl('token'); // 899_431 — ms remaining, or null

// 16 minutes later
auth.get('token'); // undefined, and the dead entry is collected
auth.has('token'); // false
```

Set `ttl` on the store to give every key the same lifetime; a per-call `ttl` overrides it.
Expiry is checked on access — there is no timer, so nothing depends on the tab staying open.
`get` and `has` collect an expired entry as they pass it; `keys()`, `size` and `entries()` hide
it but never write.

A key with a default falls back to that default once it expires.

### Timestamps

```ts
const store = createLocalStorage('s', { timestamps: true });
store.set('count', 1);
store.meta('count'); // { createdAt: 1758297600000, updatedAt: 1758297600000 }
```

Off by default: it turns every value into an envelope, and an update costs one extra read to keep
the original `createdAt`.

### Reacting to changes

```ts
const off = basket.subscribe('count', (event) => {
  event.newValue; // number | undefined — undefined means removed
  event.oldValue; // the previous value
  event.source; // 'local' in this tab, 'remote' from another
});

basket.subscribe((event) => ...); // every key; event.key is null if a tab cleared the area
off();
```

Both tabs are covered: the native `storage` event only fires in _other_ tabs, so local writes are
emitted separately. `oldValue` is free here and is never written to disk.

A subscriber that throws is reported through `onError` and skipped — it cannot stop the other
subscribers or the write. A value that fails to decode arrives as `undefined` and is reported.

### Nested namespaces

```ts
const ui = basket.child('ui');
ui.set('collapsed', true); // writes "basket:ui:collapsed"
basket.clear(); // clears the child too
```

### When storage is missing or full

```ts
const basket = createLocalStorage('basket', {
  fallback: 'memory', // 'memory' (default) | 'throw' | 'noop'
  onError: (error) => report(error),
});

basket.available; // false under SSR, private mode, or a blocked iframe

const result = basket.trySet('items', huge);
if (!result.ok) showToast('Could not save'); // result.error is a StorageQuotaError
```

### Corrupt data

Reads never throw by default — stale or hand-edited data should not crash a render.

```ts
createLocalStorage('basket', { onCorrupt: 'ignore' }); // default: undefined + onError
createLocalStorage('basket', { onCorrupt: 'remove' }); // self-healing
createLocalStorage('basket', { onCorrupt: 'throw' }); // fail fast in tests
```

## API

|                                       |                                                                   |
| ------------------------------------- | ----------------------------------------------------------------- |
| `set(key, value)`                     | writes; `undefined` removes. Throws `StorageQuotaError` when full |
| `get<T>(key)`                         | `T \| undefined`                                                  |
| `remove(key)` · `has(key)`            |                                                                   |
| `clear()`                             | this namespace only                                               |
| `keys()` · `entries()` · `size`       | namespace-relative, internal keys hidden                          |
| `setItem` · `getItem` · `removeItem`  | native-style aliases for mechanical migration                     |
| `trySet(key, value)`                  | `{ ok: true } \| { ok: false, error }`                            |
| `child(segment)`                      | a nested namespace                                                |
| `namespace` · `adapter` · `available` |                                                                   |

### Options

| option                  | default    |                                                            |
| ----------------------- | ---------- | ---------------------------------------------------------- |
| `fallback`              | `'memory'` | `'memory'` · `'throw'` · `'noop'`                          |
| `onCorrupt`             | `'ignore'` | `'ignore'` · `'remove'` · `'throw'`                        |
| `onError`               | —          | called for every error, including ones that are not thrown |
| `prefix`                | —          | app-wide prefix: `myapp:basket:count`                      |
| `separator`             | `':'`      | must not be a character legal inside a namespace           |
| `owner` · `description` | —          | metadata for the inventory; unused at runtime              |

### Errors

All extend `NamespacedStorageError` and carry a stable `.code`, plus `.namespace` and `.key`:
`StorageQuotaError`, `StorageUnavailableError`, `DecodeError`, `SerializationError`,
`ValidationError` (carries `.issues`), `SubscriberError`, `InvalidNamespaceError`,
`InvalidKeyError`, `InvalidOptionsError`.

## Constraints

- Namespace and child segments must match `/^[A-Za-z0-9_.-]+$/`. Keys are unconstrained.
- Keys starting with `__nss` are reserved.
- ES2020 · Node ≥18 · evergreen browsers · zero runtime dependencies.

## Roadmap

`0.1.0` covers namespacing, value codecs, typing, expiry and change events. Next: migrations, an ESLint plugin that bans raw storage access, and an `nss scan` CLI that generates the
"what do we store?" inventory from your source.

## License

MIT
