---
name: namespaced-storage
description: Use when writing or reviewing browser storage code in a project that depends on namespaced-storage — declaring a store, choosing between `defaults` and `schema`, TTL, migrations, SSR, or replacing raw localStorage calls. Also use when a review turns up `localStorage.getItem`, `sessionStorage.setItem`, or a storage key built by string concatenation.
---

# namespaced-storage

A namespacing, typing and governance layer over `localStorage` and `sessionStorage`. Zero runtime
dependencies, SSR-safe, 6.4 kB minified + brotlied (5.2 kB from `namespaced-storage/minimal`).

## The three levels, and when to move up

**Level 1 — namespacing.** Always start here. One line, and the keys stop colliding.

```ts
// src/features/basket/basket.storage.ts
import { createLocalStorage } from 'namespaced-storage';

export const basket = createLocalStorage('basket');
```

`basket.set('count', 10)` writes `basket:count`. `basket.clear()` clears `basket:*` and nothing
else — it never calls the native `clear()`.

**Level 2 — typing.** Move up when a key has a shape worth stating. `defaults` is the primary path:
it is a plain object, the types come from `typeof defaults`, and a key with a default never reads
back `undefined`.

```ts
export const basket = createLocalStorage('basket', {
  owner: 'team-checkout',
  description: 'Shopping basket, survives reload',
  defaults: { count: 0, items: [] as BasketItem[], lastOpened: new Date() },
});

basket.get('count'); // number, not number | undefined
basket.set('cout', 1); // compile error — key typo caught
```

Use `schema` instead when a key has no sensible default, or when stored data must be validated:

```ts
import { createSessionStorage, t } from 'namespaced-storage';

export const auth = createSessionStorage('auth', {
  ttl: 15 * 60_000,
  schema: { token: t.string(), scopes: t.array(t.string()).optional() },
});
```

Any Standard Schema validator works in place of `t.*` — Zod 3.24+, Valibot, ArkType — with no peer
dependency. The two may be combined: the schema validates, the default is the fallback.

**Level 3 — governance.** `version` + `migrate`, the ESLint plugin, `nss scan`. Reach for these
when more than one team writes to storage.

## Where a store goes

In a `*.storage.ts` file **next to the feature that owns it**, exported. There is no central
registry file to keep in sync; `npx nss scan` builds the inventory by reading the source. Two
places creating the same namespace throws `NamespaceConflictError` naming both call sites.

## The API

```ts
store.set(key, value, { ttl });   // throws on quota; set(key, undefined) removes
store.get(key);                   // never throws by default
store.remove(key); store.has(key);
store.clear();                    // this namespace only
store.keys(); store.entries(); store.size;
store.trySet(key, value);         // { ok: true } | { ok: false, error }
store.meta(key);                  // { createdAt?, updatedAt?, expiresAt? }
store.ttl(key);                   // ms remaining, or null
store.subscribe(key?, listener);  // this tab and other tabs; returns an unsubscribe
store.child('ui');                // basket:ui:* — untyped
store.inspect(); store.export();  // what is in here?
store.namespace; store.adapter; store.available;
```

`setItem` / `getItem` / `removeItem` exist as aliases so a mechanical port reads the same.

Values round-trip exactly: `Date`, `Map`, `Set`, `BigInt`, `RegExp`, `NaN`, `±Infinity` and nested
`undefined` all survive, at any depth. Plain JSON stays plain on disk, so existing raw data keeps
working and anything else reading the key still can.

## Migrations

```ts
export const basket = createLocalStorage('basket', {
  defaults: { items: [] as Item[] },
  version: 2,
  migrate: (previous, fromVersion) => {
    if (fromVersion < 2) return { items: (previous.cart as Item[]) ?? [] };
    return previous;
  },
});
```

Runs once, at construction, before the first read. `previous` is every readable key, decoded but
not validated. Return the new shape, or return nothing and mutate `previous`. Keys the result does
not carry are removed; unchanged keys keep their timestamps and TTL. A failure throws
`MigrationError` without advancing the version, so the next load retries — write migrations that
tolerate running twice.

## Common mistakes

| don't                                           | do                                                     |
| ----------------------------------------------- | ------------------------------------------------------ |
| `localStorage.getItem('basketCount')`           | `basket.get('count')`                                  |
| `createLocalStorage(\`basket-\${id}\`)`         | a literal namespace, and `basket.child(id)` underneath |
| `basket.set('count', 1).asNumber()`             | declare the type once, in `defaults`                   |
| `localStorage.clear()`                          | `basket.clear()` — scoped, and it is the only safe one |
| a second `createLocalStorage('basket')`         | import the one that exists                             |
| `JSON.parse(localStorage.getItem(k) ?? 'null')` | `store.get(k)` — parsing and codecs are done for you   |
| keys starting with `__nss`                      | anything else; that prefix is reserved                 |

**SSR.** Nothing here crashes without `window`: the store falls back to memory, `store.available`
is `false`, and `onError` fires once. Declaring a store at module scope is safe in Next.js.

**Reads never throw** by default — corrupt data reads as the default and is reported through
`onError` (`onCorrupt` / `onInvalid` change that). **Writes always throw**; use `trySet` where
quota is a real possibility, such as anything user-sized.

**Expiry is lazy.** There is no timer: `get` and `has` collect an expired entry as they pass it,
and `keys()` / `size` / `entries()` hide it without writing.

## Porting raw storage code

1. Create the store in a `*.storage.ts` file beside the feature, with a literal namespace.
2. Move every key that shared a prefix into it, dropping the prefix from the key.
3. Replace `JSON.parse` / `String(...)` / `new Date(...)` wrappers — the codecs do that now.
4. Turn the shapes you were asserting into `defaults`.
5. Turn `localStorage.clear()` into the specific `store.clear()` calls it was standing in for.
6. Add `eslint-plugin-namespaced-storage` so the next raw call is caught in review, and run
   `npx nss scan` in CI so a duplicate namespace fails the build.

Pre-existing raw values are readable as-is: a plain JSON value written by the old code reads back
through `get` unchanged, so a port can be incremental.
