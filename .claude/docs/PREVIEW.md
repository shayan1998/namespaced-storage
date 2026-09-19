# Preview — what the finished thing actually looks like

> A dry run of the 1.0 output, written before implementation so the design can be critiqued against
> something concrete. Nothing here is implemented yet.
> Design source of truth: [PLAN.md](./PLAN.md) · [DECISIONS.md](./DECISIONS.md)

---

## 1. Install

```bash
pnpm add namespaced-storage
pnpm add -D eslint-plugin-namespaced-storage nss
```

## 2. Level 1 — namespacing, two lines

```ts
// src/features/basket/basket.storage.ts
import { createLocalStorage } from 'namespaced-storage';

export const basket = createLocalStorage('basket');
```

```ts
// anywhere
import { basket } from '@/features/basket/basket.storage';

basket.set('count', 10);
basket.get<number>('count'); // number | undefined
basket.clear(); // basket:* only — every other namespace untouched
```

That is the whole first level. No schema, no registry, no new concepts.

## 3. Level 2 — add types with a plain object

```ts
// src/features/basket/basket.storage.ts
import { createLocalStorage } from 'namespaced-storage';
import type { BasketItem } from './types';

export const basket = createLocalStorage('basket', {
  owner: 'team-checkout',
  description: 'Shopping basket, survives reload',
  defaults: {
    count: 0,
    items: [] as BasketItem[],
    lastOpened: new Date(),
  },
});
```

```ts
basket.set('count', 10);
basket.get('count'); // 10    → number, not number | undefined (it has a default)
basket.get('items'); // []    → BasketItem[]
basket.get('lastOpened'); // Date  → a real Date object
```

`defaults` is an ordinary JS object. Types come from `typeof defaults`; the `Date` codec is picked up
from the default's constructor at runtime.

### When `defaults` is not enough

A key with no sensible default, or data that must be validated:

```ts
// src/features/auth/auth.storage.ts
import { createSessionStorage, t } from 'namespaced-storage';

export const auth = createSessionStorage('auth', {
  owner: 'team-identity',
  ttl: 15 * 60_000,
  schema: {
    token: t.string(),
    refreshAt: t.date(),
    scopes: t.array(t.string()).optional(),
  },
});
```

Or any Standard Schema validator, with no peer dependency:

```ts
import { z } from 'zod';
schema: { token: z.string().min(10), scopes: z.array(z.string()).optional() }
```

`defaults` and `schema` can be combined in one call; the typed key set is the union.

## 4. What actually lands in localStorage

This is the part to scrutinize — it is where the "smart envelope" decision is visible.

**DevTools → Application → Local Storage**

| Key                 | Value                                      |
| ------------------- | ------------------------------------------ |
| `basket:count`      | `10`                                       |
| `basket:items`      | `[{"id":"sku-1","qty":2}]`                 |
| `basket:lastOpened` | `{"__nss":1,"v":1758297600000,"t":"date"}` |
| `ui:theme`          | `"dark"`                                   |
| `ui:sidebarOpen`    | `true`                                     |

**Session Storage**

| Key              | Value                                                        |
| ---------------- | ------------------------------------------------------------ |
| `auth:token`     | `{"__nss":1,"v":"eyJhbGciOi…","e":1758298500000}`            |
| `auth:refreshAt` | `{"__nss":1,"v":1758298200000,"t":"date","e":1758298500000}` |

Read this table as the design summary:

- **Plain values stay plain.** `count`, `items`, `theme` are exactly what raw `JSON.stringify` would
  have written. Any other code, library, or server-rendered bootstrap can still read them.
- **The envelope appears only where it earns its place** — `lastOpened` needs the `date` tag to come
  back as a `Date`; `auth:*` needs `e` for expiry.
- **Existing data keeps working.** If `basket:count` already held `10` before you adopted the
  package, `get('count')` returns `10`. Adoption is incremental, key by key.

## 5. Compile-time safety

```ts
basket.set('cout', 10);
//         ~~~~~~
// Argument of type '"cout"' is not assignable to parameter of type
// '"count" | "items" | "lastOpened"'. ts(2345)

basket.set('count', 'ten');
//                  ~~~~~
// Argument of type 'string' is not assignable to parameter of type 'number'. ts(2345)

const c = basket.get('count'); // c: number
const d = basket.get('lastOpened'); // d: Date
const s = auth.get('scopes'); // s: string[] | undefined  (optional, no default)
```

## 6. TTL and expiry

```ts
auth.set('token', jwt); // uses the namespace ttl: 15 min
auth.set('token', jwt, { ttl: 60_000 }); // per-call override

auth.ttl('token'); // 899_431  (ms remaining)

// 16 minutes later
auth.get('token'); // undefined — expired and lazily deleted
auth.has('token'); // false
```

## 7. Reacting to changes (including from another tab)

```ts
const off = basket.subscribe('count', (e) => console.log(e));

// this tab:        { key:'count', newValue:11, oldValue:10, source:'local'  }
// a different tab: { key:'count', newValue:11, oldValue:10, source:'remote' }

const offAll = basket.subscribe((e) => console.log(e)); // all keys
off();
```

`oldValue` is available here — free from the native `storage` event — but is never written to disk
(ADR-004).

## 8. When storage misbehaves

```ts
// SSR / Node — no window at all
export const basket = createLocalStorage('basket'); // no throw at import or construction
basket.available; // false
basket.set('count', 1); // in-memory fallback
basket.get('count'); // 1 — the app keeps working
```

```ts
// Quota exceeded
basket.set('items', hugeArray);
// throws StorageQuotaError:
//   [namespaced-storage] Quota exceeded writing "basket:items" (≈4.7 MB).
//   localStorage is full. See https://…/errors#quota

const r = basket.trySet('items', hugeArray);
if (!r.ok) showToast('Could not save your basket');
```

```ts
// Someone hand-edited the value in DevTools to `{oops`
basket.get('items'); // [] — the default; never throws during a render
// and onError fires:
//   DecodeError: [namespaced-storage] Could not parse "basket:items" (SyntaxError at position 1)
```

```ts
// Duplicate namespace, caught at runtime in dev
createLocalStorage('basket');
// throws NamespaceConflictError:
//   [namespaced-storage] Namespace "basket" is already registered
//     first:  src/features/basket/basket.storage.ts:6
//     second: src/legacy/cart/store.ts:11
//   Import the existing store instead of creating a new one.
//   Pass { strict: false } if this is intentional.
```

## 9. Discoverability — generated, never hand-maintained

There is no central file anyone has to keep in sync. The inventory is derived from the source.

```
$ npx nss scan

namespaced-storage · 7 namespaces across 6 files

  auth      session  team-identity   src/features/auth/auth.storage.ts        2 keys   ttl 15m
  basket    local    team-checkout   src/features/basket/basket.storage.ts    3 keys
  ui        local    team-platform   src/shared/ui/ui.storage.ts              3 keys
  onboard   local    team-growth     src/features/onboarding/ob.storage.ts    1 key
  flags     local    team-platform   packages/flags/src/flags.storage.ts      2 keys
  search    session  team-discovery  packages/search/src/recent.storage.ts    1 key

✖ duplicate namespace "cart"
    src/features/basket/basket.storage.ts:4
    src/legacy/cart/store.ts:11

✖ 1 problem
```

```bash
npx nss scan --json              # machine-readable manifest
npx nss docs -o docs/storage.md  # markdown inventory, committed and reviewed
```

Run `nss scan` in CI. It catches duplicates **across packages in a monorepo** — something a central
object literal could never do.

`docs/storage.md`, generated:

| namespace | storage | owner         | keys                                                       | description                      |
| --------- | ------- | ------------- | ---------------------------------------------------------- | -------------------------------- |
| `auth`    | session | team-identity | `token: string`, `refreshAt: Date`                         | Short-lived access token         |
| `basket`  | local   | team-checkout | `count: number`, `items: BasketItem[]`, `lastOpened: Date` | Shopping basket, survives reload |
| `ui`      | local   | team-platform | `theme: 'light' \| 'dark'`, `sidebarOpen: boolean`         | —                                |

## 10. The ESLint plugin

```js
// eslint.config.js
import nss from 'eslint-plugin-namespaced-storage';

export default [nss.configs.recommended];
```

```
$ pnpm lint

/src/features/basket/CartBadge.tsx
  12:15  error  Direct use of 'localStorage' is not allowed. Use a namespaced store
                instead                                     namespaced-storage/no-direct-storage
  19:3   error  Direct use of 'window.sessionStorage' is not allowed
                                                            namespaced-storage/no-direct-storage

/src/legacy/bootstrap.ts
  31:9   error  Namespace must be a string literal so 'nss scan' can find it
                                                   namespaced-storage/require-namespace-literal

✖ 3 problems (3 errors, 0 warnings)
```

## 11. Devtools

```ts
basket.inspect();
```

```
namespaced-storage · basket (local) · 3 keys · 148 B

┌────────────┬─────────────────────────────┬────────┬──────┬─────────┐
│ key        │ value                       │ type   │ size │ expires │
├────────────┼─────────────────────────────┼────────┼──────┼─────────┤
│ count      │ 10                          │ number │ 2 B  │ —       │
│ items      │ [{ id: 'sku-1', qty: 2 }]   │ array  │ 25 B │ —       │
│ lastOpened │ 2026-09-19T14:00:00.000Z    │ date   │ 44 B │ —       │
└────────────┴─────────────────────────────┴────────┴──────┴─────────┘
```

## 12. Migration from raw code

Before:

```ts
localStorage.setItem('basketCount', String(count));
const count = Number(localStorage.getItem('basketCount') ?? 0);
localStorage.setItem('basketLastOpened', new Date().toISOString());
const d = new Date(localStorage.getItem('basketLastOpened')!);
```

After:

```ts
basket.set('count', count);
const count = basket.get('count');
basket.set('lastOpened', new Date());
const d = basket.get('lastOpened');
```

## 13. Repo output

```
namespaced-storage/
├── packages/
│   ├── core/            namespaced-storage
│   ├── cli/             nss
│   └── eslint-plugin/   eslint-plugin-namespaced-storage
├── examples/            vanilla-ts · react · next-ssr
├── docs/                README source · llms.txt · errors reference
└── .claude/
    ├── docs/            PLAN.md · DECISIONS.md · PREVIEW.md
    └── skills/namespaced-storage/SKILL.md
```

```
$ pnpm size

  core (level 1, namespace only)   2.6 kB gzip   (budget 3.0 kB)
  core + typing                    4.9 kB gzip   (budget 5.5 kB)
```

---

## Open points for review

| #   | Point                                          | Current choice                                  | Alternative                                     |
| --- | ---------------------------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| 1   | Unknown key on a typed store                   | compile error, `getUnsafe()` escape hatch       | fall back to `unknown`                          |
| 2   | Memory fallback                                | shared per adapter                              | per instance                                    |
| 3   | `inspect()` in production                      | stripped by `NODE_ENV`                          | always present                                  |
| 4   | `nss scan` reporting keys, not just namespaces | yes, read from the `defaults`/`schema` literals | namespaces only, simpler and no false negatives |
| 5   | Per-namespace `__nss:meta` key for the version | one extra key per namespace                     | version inside each envelope instead            |
