# Migrating from raw storage

A port is mechanical, and it can be incremental: a plain JSON value written by your old code reads
back through `get` unchanged, so a namespace can be half-ported and still work.

## One feature at a time

**Before.** Keys share a prefix by convention, types live in whoever remembered to cast, and one
stray `clear()` takes out everyone's data.

```ts
localStorage.setItem('basketCount', String(count));
const count = Number(localStorage.getItem('basketCount') ?? 0);

localStorage.setItem('basketItems', JSON.stringify(items));
const items = JSON.parse(localStorage.getItem('basketItems') ?? '[]') as BasketItem[];

localStorage.setItem('basketLastOpened', new Date().toISOString());
const lastOpened = new Date(localStorage.getItem('basketLastOpened')!);
```

**After.** One declaration, next to the feature that owns it.

```ts
// src/features/basket/basket.storage.ts
import { createLocalStorage } from 'namespaced-storage';

export const basket = createLocalStorage('basket', {
  owner: 'team-checkout',
  defaults: { count: 0, items: [] as BasketItem[], lastOpened: new Date() },
});
```

```ts
basket.set('count', count);
const count = basket.get('count'); // number

basket.set('items', items);
const items = basket.get('items'); // BasketItem[]

basket.set('lastOpened', new Date());
const lastOpened = basket.get('lastOpened'); // a real Date
```

## The six steps

1. **Create the store** in `*.storage.ts` beside the feature, with a **literal** namespace, and
   export it. Never construct it twice — import the one that exists.
2. **Move the keys in**, dropping the prefix they shared: `basketCount` becomes `count`.
3. **Delete the wrappers.** `JSON.parse`, `String(...)`, `new Date(...)`, `?? '[]'` — all of that
   is the library's job now, including `Map`, `Set`, `BigInt` and `NaN`.
4. **Turn the casts into `defaults`.** Whatever you were asserting at the read site is the type;
   whatever you were falling back to is the default.
5. **Replace `localStorage.clear()`** with the specific `store.clear()` calls it stood in for. This
   is usually where a port finds a real bug.
6. **Lock the door.** Add the ESLint plugin so the next raw call is caught in review, and run
   `npx nss scan` in CI so a duplicate namespace fails the build.

```js
// eslint.config.js
import nss from 'eslint-plugin-namespaced-storage';
export default [nss.configs.recommended];
```

## Renaming keys as you go

If the port changes a key's name or shape, that is a migration, not a rewrite of the reading code:

```ts
export const basket = createLocalStorage('basket', {
  defaults: { items: [] as BasketItem[] },
  version: 2,
  migrate: (previous) => ({ items: (previous.basketItems as BasketItem[]) ?? [] }),
});
```

It runs once, at construction, before the first read.

## What does not change

- **The bytes on disk.** A JSON-native value is stored exactly as `JSON.stringify` would write it,
  so other code — an analytics snippet, a legacy bundle, a browser extension — keeps reading it.
- **Synchronous reads.** `get` is not a promise, and it can be called during a React render.
- **Your keys.** Only the prefix changes, and only the part you dropped in step 2.
