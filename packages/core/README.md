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
`InvalidNamespaceError`, `InvalidKeyError`, `InvalidOptionsError`.

## Constraints

- Namespace and child segments must match `/^[A-Za-z0-9_.-]+$/`. Keys are unconstrained.
- Keys starting with `__nss` are reserved.
- ES2020 · Node ≥18 · evergreen browsers · zero runtime dependencies.

## Roadmap

`0.1.0` is the namespacing core plus full value codecs. Next: typing via a `defaults` object, TTL,
cross-tab change events, migrations, an ESLint plugin that bans raw storage access, and an
`nss scan` CLI that generates the "what do we store?" inventory from your source.

## License

MIT
