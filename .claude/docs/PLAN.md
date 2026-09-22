# namespaced-storage — Master Plan

> Living document. Every design change goes here first, then into code.
> Companion: [DECISIONS.md](./DECISIONS.md) (ADR log) · [PREVIEW.md](./PREVIEW.md) (dry run of the output).

**Status:** M0–M6 done (`0.1.0`) · **Target first release:** `1.0.0` · **npm name:** `namespaced-storage` (verified available)

---

## 1. Problem

In a large or long-lived JS codebase, browser storage (`localStorage`, `sessionStorage`, cookies) is a
global mutable namespace with no owner, no schema, and no discoverability:

1. **Collisions** — team A writes `token`, team B overwrites `token`. Nobody notices until production.
2. **No discoverability** — nobody can answer "what does this app persist, and who owns it?"
   without grepping for `setItem` across the repo.
3. **`localStorage.clear()` nukes everything**, including other teams' data.
4. **Everything is a string** — manual `JSON.parse`/`stringify` at every call site, and `Date`,
   `Map`, `Set`, `BigInt` silently degrade.
5. **No compile-time safety** — key typos and wrong value types are runtime-only bugs.
6. **Environment landmines** — `localStorage` is `undefined` in SSR, _throws `SecurityError` on
   property access_ in a cookie-blocked iframe, and throws `QuotaExceededError` in Safari private mode
   even at zero bytes.

## 2. Solution — three independent levels

The package must be valuable at level 1 and never force anyone up the ladder.

**Level 1 — namespacing.** Two lines, no new concepts.

```ts
export const basket = createLocalStorage('basket');
basket.set('count', 10);
```

**Level 2 — typing.** Add a plain `defaults` object; types and codecs are inferred from it.

```ts
export const basket = createLocalStorage('basket', {
  defaults: { count: 0, items: [] as Item[], lastOpened: new Date() },
});
```

**Level 3 — governance.** No extra code: an ESLint plugin bans raw storage access, and a CLI
generates the "what do we store?" manifest from the codebase.

### Honest scope statement (must appear in the README)

> This package provides **discipline, not security.** Any code can construct a second instance of the
> same namespace. What it eliminates is _accidental_ collision, _accidental_ `clear()`, and _silent_
> type drift — and what it adds is a generated, always-current inventory of everything the app stores.

## 3. Non-goals

- Encryption / obfuscation of values (false sense of security in client-side JS).
- A reactive state manager (this is a storage layer; bind it to your own store).
- Replacing IndexedDB for large binary data.
- Cross-origin storage.
- **A hand-maintained central registry file** — see ADR-011.

---

## 4. Decisions locked in

| #   | Question                      | Decision                                                                                                                                      | ADR |
| --- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| 1   | Where namespaces are declared | **Co-located with the feature** (`src/features/basket/basket.storage.ts`). No central object. Discoverability comes from a generated manifest | 011 |
| 2   | How types are declared        | **`defaults` object, types inferred** (primary). `t.*` / Standard Schema for validation and defaultless keys                                  | 012 |
| 3   | Factory naming                | **`createLocalStorage` / `createSessionStorage`** — explicit and self-documenting                                                             | 013 |
| 4   | Storage format                | **Smart/auto** — plain JSON by default; envelope only when a feature needs it                                                                 | 003 |
| 5   | Validator dependency          | Built-in zero-dep `t.*` + Standard Schema v1 adapter. No peer dependency                                                                      | 007 |
| 6   | Sync vs async                 | Adapter declares `kind`; separate sync and async store types                                                                                  | 006 |
| 7   | v1 scope                      | Full browser core **plus the `nss` CLI** (promoted from 1.1 — it replaces the central registry)                                               | 011 |

---

## 5. Public API

### 5.1 Level 1 — namespacing only

```ts
// src/features/basket/basket.storage.ts
import { createLocalStorage } from 'namespaced-storage';

export const basket = createLocalStorage('basket');
```

```ts
import { basket } from '@/features/basket/basket.storage';

basket.set('count', 10); // writes localStorage key "basket:count" = "10"
basket.get<number>('count'); // number | undefined
basket.remove('count');
basket.clear(); // clears ONLY basket:* — never touches other namespaces
```

`set/get/remove` are the primary names (matching `Map`). `setItem/getItem/removeItem` exist as
aliases so migration from raw `localStorage` is mechanical.

> **Rejected:** `basket.add('count', 10)` — `add` means insert/append in JS (`Set.add`); this is an
> upsert, so `set` is correct.

### 5.2 Level 2 — typing via `defaults`

```ts
export const basket = createLocalStorage('basket', {
  owner: 'team-checkout',
  description: 'Shopping basket, survives reload',
  defaults: {
    count: 0,
    items: [] as BasketItem[],
    lastOpened: new Date(), // the Date codec is inferred from this value
  },
});

basket.set('count', 10); // ✅
basket.set('count', 'ten'); // ❌ compile error
basket.set('cout', 10); // ❌ compile error — key typo caught
basket.get('count'); // number  (not number | undefined — it has a default)
basket.get('lastOpened'); // Date
```

`defaults` is an ordinary JS object. There is no DSL to learn, inference is `typeof defaults`, and the
runtime reads the constructor of each default to pick the codec.

> **Rejected:** `basket.set('count', 10).setType('number')` — declaring the type after the write is
> backwards, repeated at every call site, invisible to TypeScript, and redundant for JSON-native
> types. See ADR-002.

### 5.3 Level 2b — `schema` for validation and defaultless keys

Use when a key has no sensible default, or when stored data must be validated.

```ts
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

Any [Standard Schema v1](https://standardschema.dev) validator works instead of `t.*` — Zod ≥3.24,
Valibot, ArkType, Effect Schema — detected structurally via the `~standard` property, with no peer
dependency declared:

```ts
schema: { token: z.string().min(10), scopes: z.array(z.string()).optional() }
```

**`defaults` and `schema` may be combined.** The typed key set is the union of both. A key appearing
in both throws `InvalidOptionsError` at construction.

### 5.4 Full surface (1.0)

```ts
interface SyncNamespacedStore<T> {
  // core
  set<K extends keyof T>(key: K, value: T[K], opts?: { ttl?: number }): void;
  get<K extends keyof T>(key: K): T[K] | undefined; // no `| undefined` when the key has a default
  remove(key: keyof T): void;
  has(key: keyof T): boolean;
  clear(): void; // namespace-scoped only
  readonly size: number;
  keys(): (keyof T)[];
  entries(): [keyof T, T[keyof T]][];

  // native-compatible aliases
  setItem;
  getItem;
  removeItem;

  // non-throwing write (quota-safe)
  trySet(key, value, opts?): { ok: true } | { ok: false; error: NamespacedStorageError };

  // metadata
  meta(
    key,
  ): { type?: string; createdAt?: number; updatedAt?: number; expiresAt?: number } | undefined;
  ttl(key): number | null; // ms remaining, null if no expiry

  // reactivity — cross-tab (storage event) + in-process
  subscribe(key, cb: (e: ChangeEvent) => void): Unsubscribe;
  subscribe(cb: (e: ChangeEvent) => void): Unsubscribe; // all keys

  // composition
  child(sub: string): SyncNamespacedStore<unknown>; // basket.child('ui') -> "basket:ui:*"

  // devtools / ops
  inspect(): void; // console.table of the namespace — present in every build
  export(): Record<string, unknown>; // plain snapshot, same values get() returns

  // identity
  readonly namespace: string;
  readonly adapter: string;
  readonly available: boolean;
}

interface ChangeEvent {
  key: string;
  newValue: unknown | undefined;
  oldValue: unknown | undefined; // previous value, in the event only — never persisted
  source: 'local' | 'remote'; // remote = another tab
}
```

Deferred to 1.1: `values()` (covered by `entries()`), `touch()`, `import()`.

> **Note on `oldValue`:** the original idea was to _persist_ the previous value. We surface it in the
> change event instead — where the native `storage` event already provides it for free — and never
> write it to disk. Persisting would double the footprint of every key against a ~5 MB budget and
> keep deleted tokens alive indefinitely. See ADR-004.

### 5.5 Options

```ts
interface StoreOptions {
  defaults?: Record<string, unknown>;
  schema?: Record<string, StandardSchemaV1 | TSchema>;

  owner?: string; // read by `nss scan` for the manifest
  description?: string; // read by `nss scan` for the manifest

  version?: number; // default 1; nothing is stamped on disk until it passes 1
  migrate?: (
    previous: Record<string, unknown>,
    fromVersion: number,
  ) => Record<string, unknown> | void;

  fallback?: 'memory' | 'throw' | 'noop'; // adapter unavailable; default 'memory'
  separator?: string; // default ':'
  prefix?: string; // optional global app prefix, e.g. 'myapp'

  timestamps?: boolean; // default false
  ttl?: number; // default TTL for every key in this namespace

  onCorrupt?: 'ignore' | 'remove' | 'throw'; // unparseable data;      default 'ignore'
  onInvalid?: 'ignore' | 'remove' | 'throw'; // fails validation;      default 'ignore'
  onError?: (error: NamespacedStorageError) => void;

  strict?: boolean; // default true in dev — guard duplicate namespaces
}
```

### 5.7 Devtools

```ts
basket.inspect(); // one console.table of this namespace
basket.export(); // { count: 10, items: [...] } — a plain snapshot
```

`inspect()` writes a summary line and hands the rows to the host's own `console.table`, rather than
drawing a table itself: the browser and Node already render one, and one that folds objects open.

Both ship in **every** build, production included — a namespace you cannot inspect in production is
a namespace you cannot debug where it matters (ADR-023). What is development-only is the global
hook, which exists so the console can reach a store nothing exported to it:

```js
__NAMESPACED_STORAGE__.stores.basket.get('count');
__NAMESPACED_STORAGE__.inspect(); // every namespace on the page, one row each
```

It is registered by the factory when `NODE_ENV` is not `production`, and holding every store alive
in a global is exactly why it is not registered in production.

### 5.6 Discoverability — generated, not hand-maintained

There is no central file to keep in sync. `nss scan` walks the source, finds every
`createLocalStorage` / `createSessionStorage` call with a literal namespace, and reports the
inventory. Run it in CI.

```
$ npx nss scan

namespaced-storage · 7 namespaces across 6 files

  auth      session  team-identity   src/features/auth/auth.storage.ts       2 keys
  basket    local    team-checkout   src/features/basket/basket.storage.ts   3 keys
  ui        local    team-platform   src/shared/ui/ui.storage.ts             3 keys

✖ duplicate namespace "cart"
    src/features/basket/basket.storage.ts:4
    src/legacy/cart/store.ts:11
```

`nss scan --json` emits the machine-readable manifest; `nss docs -o docs/storage.md` writes the
markdown inventory. This catches duplicates **across packages in a monorepo**, which a central object
literal cannot.

At runtime, a global registry throws `NamespaceConflictError` the moment a duplicate namespace is
constructed (dev only, `strict: false` to opt out; re-registration with an identical config warns
instead of throwing, so Vite HMR is not broken).

---

## 6. Storage format

### 6.1 Key encoding

```
[prefix <sep>] namespace [<sep> child]* <sep> key
```

Examples: `basket:count`, `basket:ui:collapsed`, `myapp:basket:count`.

- Default separator `:`; default prefix none.
- Namespace and child segments **must** match `/^[A-Za-z0-9_.-]+$/`, which guarantees they cannot
  contain the separator. Violations throw `InvalidNamespaceError` at construction.
- The **user key is unconstrained** and may contain the separator, because it is always the final
  segment. Decoding is `raw.slice(prefix.length)`, never `split()`.
- Keys beginning with `__nss` are reserved (`basket:__nss:meta` holds the namespace version).

### 6.2 Value encoding — "smart envelope"

Two on-disk shapes; the reader detects which one it is.

**Plain (default):** `JSON.stringify(value)` → `10`, `"hi"`, `{"a":1}`
Maximum interoperability, minimum size, and pre-existing raw data keeps working.

**Envelope (only when needed):**

```json
{
  "__nss": 1,
  "v": <payload>,
  "t": [[["user", "lastSeen"], "date"]],
  "c": 1700000000000,
  "u": 1700000000000,
  "e": 1700000600000
}
```

| field     | meaning                                                        | present when                |
| --------- | -------------------------------------------------------------- | --------------------------- |
| `__nss`   | envelope format version — also the magic marker                | always (in an envelope)     |
| `v`       | the payload: the user's structure, unmodified                  | always                      |
| `t`       | `[path, tag]` pairs for values JSON cannot represent (ADR-014) | any such value at any depth |
| `c` / `u` | createdAt / updatedAt (ms)                                     | `timestamps: true`          |
| `e`       | expiresAt (ms)                                                 | a TTL is set                |

Tags are recorded **out of band, by path**, so nothing is ever injected into the user's data and the
payload stays byte-identical to what they passed in. Supported tags: `date`, `map`, `set`, `bigint`,
`regexp`, `undef`, `nan`, `inf`, `-inf`.

**Encode:**

1. Run the codec for the value's type (from `defaults`/`schema`, else inferred from the value).
2. `needsEnvelope = codecTag !== undefined || ttl || timestamps || (isPlainObject(encoded) && '__nss' in encoded)`
3. Wrap if needed, otherwise stringify plainly.

**Decode:**

1. `JSON.parse(raw)`; on failure apply `onCorrupt` and report via `onError`.
2. Non-null plain object with an own numeric `__nss` → envelope; unwrap and run the codec in reverse.
   If `e` is in the past, treat as missing and lazily delete.
3. Otherwise → plain value.

Step 2 of encode is what makes this collision-proof: an object that genuinely contains a top-level
`__nss` forces envelope mode, so the round-trip stays exact for every possible input.

### 6.3 The namespace record

One reserved key per namespace holds what is true of the namespace rather than of any one entry.
Today that is the schema version and nothing else.

```
basket:__nss:meta   →   {"v":2}
```

- It is written **only when `version` is greater than 1**. A store that never asks for versioning
  never pays a read, a write or a byte for it.
- Its key starts with `__nss`, so it is already invisible to `keys()`, `entries()`, `size` and
  `subscribe()`, and `clear()` already removes it along with the data it describes.
- Absent while data is present means the data predates versioning: it is read as version 1.
- Only the root store carries one. `basket.child('ui')` is a view, not a namespace (ADR-022).

---

## 7. Architecture

### 7.1 Sync vs async — the load-bearing decision

`localStorage` is synchronous; Redis is not. A single API cannot honestly be both.

Forcing everything async (the `unstorage` approach) destroys the browser DX — `await store.get(k)`
cannot be called during a React render. Forcing everything sync makes Redis impossible.

**Resolution:** an adapter declares `kind: 'sync' | 'async'`; the factory returns the matching store
type. Key encoding, codecs, envelope, typing, events and migration are adapter-agnostic shared
modules. Redis in v2 is a new adapter plus an async shell — no redesign.

```ts
interface SyncAdapter {
  kind: 'sync';
  name: string;
  isAvailable(): boolean; // fully try/catch-wrapped
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  keys(): string[];
  subscribe?(cb: (e: RawChange) => void): () => void;
}
// AsyncAdapter is the same shape with Promise returns. Declared in v1, implemented in v2.
```

### 7.2 Environment guards

Every touch of `window.localStorage` is inside `try/catch`, because **property access itself can
throw `SecurityError`** in a cookie-blocked iframe.

Availability probe, run once per adapter and cached:

1. the property is reachable without throwing;
2. a write/read/delete round-trip on a throwaway probe key succeeds (catches Safari private mode,
   where `setItem` throws at zero bytes).

Failure → the `fallback` policy: `'memory'` (default — a Map-backed adapter, the app keeps working),
`'throw'`, or `'noop'`. In all cases `onError` fires once and `store.available` is `false`.

### 7.3 Error taxonomy

```
NamespacedStorageError            (base — .code, .namespace, .key?, .cause?)
├── StorageUnavailableError       adapter missing / blocked
├── StorageQuotaError             QuotaExceededError, normalized across browsers
├── NamespaceConflictError        duplicate namespace under strict mode
├── InvalidNamespaceError         bad namespace/child/key
├── InvalidOptionsError           e.g. a key in both `defaults` and `schema`
├── DecodeError                   stored data is not parseable
├── ValidationError               value fails the schema (carries the issue list)
└── MigrationError                a migration threw or returned an invalid shape
```

`set()` throws; `trySet()` returns a result. Reads never throw by default (ADR-009).

### 7.4 Module layout

```
packages/core/src/
├── index.ts                public API
├── types.ts  errors.ts
├── namespace/  key.ts      encode/decode/validate
│              registry.ts  global duplicate guard (HMR-tolerant)
├── codec/      envelope.ts json.ts  builtins.ts  infer.ts
├── typing/     defaults.ts inference from a defaults object
│              t.ts        mini schema builders
│              standard.ts Standard Schema v1 adapter
│              validate.ts
├── adapters/   types.ts    web-storage.ts  memory.ts
├── store/      sync.ts     async.ts (interface only in v1)  create.ts
└── features/   ttl.ts      events.ts  migrate.ts  inspect.ts
```

### 7.5 Repository layout (pnpm monorepo)

```
namespaced-storage/
├── packages/
│   ├── core/            → namespaced-storage
│   ├── cli/             → nss            (scan · docs · json manifest)
│   └── eslint-plugin/   → eslint-plugin-namespaced-storage
├── examples/            vanilla-ts · react · next-ssr
├── docs/                README source · llms.txt · errors reference
└── .claude/
    ├── docs/            PLAN.md · DECISIONS.md · PREVIEW.md
    └── skills/namespaced-storage/SKILL.md
```

A monorepo because the ESLint plugin and CLI must ship separately — different consumers, Node-only
dependencies, and neither may be bundled into the runtime.

---

## 8. ESLint plugin

`eslint-plugin-namespaced-storage` — flat config + legacy config exports.

| rule                        | default             | does                                                                                                                                        |
| --------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-direct-storage`         | error (recommended) | bans `localStorage`, `sessionStorage`, `window.*`, `globalThis.*`, `self.*`, optionally `document.cookie`. Options: `allow`, `allowInFiles` |
| `require-namespace-literal` | error (recommended) | the namespace argument must be a string literal, so `nss scan` can see it                                                                   |
| `no-reserved-key`           | error (recommended) | rejects keys beginning with `__nss`                                                                                                         |
| `storage-file-convention`   | warn (strict)       | factory calls belong in a `*.storage.ts` file, co-located with the feature                                                                  |

Note that `require-namespace-literal` is now **error, not warn** — the CLI's inventory depends on it.

---

## 9. AI skill

`.claude/skills/namespaced-storage/SKILL.md`, also shipped in the package under `skill/` so consumers
can copy it into their own `.claude/skills/`. Plus `AGENTS.md` and `docs/llms.txt`.

Content: the three levels and when to move up, the co-located file convention, the full API with
examples, the common mistakes (chaining a type after `set`, raw `localStorage`, `clear()`
expectations, SSR), and a migration recipe from raw storage calls.

---

## 10. Milestones

Each milestone ends green: tests passing, types building, size budget met.

| #         | Milestone                | Contents                                                                                                                                                                                    |
| --------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0** ✅ | Scaffold                 | pnpm workspace, TS strict, tsup dual ESM/CJS, Vitest + happy-dom, ESLint 9 + Prettier, changesets, GitHub Actions, size-limit                                                               |
| **M1** ✅ | Walking skeleton         | key encode/decode/validate · web-storage + memory adapters · availability probe + fallback · error taxonomy · `set/get/remove/has/clear/keys/size` → **`0.1.0`, already useful at level 1** |
| **M2** ✅ | Codecs                   | smart envelope · builtin codecs (Date, Map, Set, BigInt, RegExp, undefined) · `__nss` collision rule · legacy-raw-value compatibility                                                       |
| **M3** ✅ | Typing                   | `defaults` inference (primary path) · mini `t.*` · Standard Schema v1 adapter · combining both · `onInvalid` policy                                                                         |
| **M4** ✅ | Time                     | `timestamps` · TTL with lazy expiry on read · `meta()` · `ttl()`                                                                                                                            |
| **M5** ✅ | Reactivity & composition | cross-tab `storage` event filtered by prefix · in-process emitter · `subscribe` · `child()`                                                                                                 |
| **M6** ✅ | Namespace guard          | global registry · `NamespaceConflictError` with both creation sites · HMR tolerance                                                                                                         |
| **M7** ✅ | Versioning               | `version` + `migrate` · per-namespace `__nss:meta` key · `MigrationError`                                                                                                                   |
| **M8** ✅ | Devtools                 | `inspect()` · `export()` · `globalThis.__NAMESPACED_STORAGE__` (dev builds only)                                                                                                            |
| **M9**    | ESLint plugin            | the four rules, both configs, rule tests                                                                                                                                                    |
| **M10**   | `nss` CLI                | `scan` (inventory + cross-file duplicate detection) · `--json` manifest · `docs` generator · CI recipe                                                                                      |
| **M11**   | Docs & DX                | README · docs site · SKILL.md · `llms.txt` · three examples · migration guide                                                                                                               |
| **M12**   | Harden & ship            | env matrix tests, `publint` + `@arethetypeswrong/cli`, size budget, npm provenance → **`1.0.0`**                                                                                            |

### Shipped so far

**M0–M8 → `0.1.0`.** 283 tests, 99.8% lines, 6.33 kB minified+brotli against a 6.4 kB budget,
`publint` and `attw` clean on both ESM and CJS entry points. Everything through devtools is
implemented, documented in the README, and covered.

Two things **M1** surfaced that were not in the plan:

- **Separator validation.** A custom `separator` made only of characters a namespace may legally
  contain (`.`, `-`) would make encoded keys ambiguous, so it is now rejected at construction.
- **`set(key, undefined)` means remove.** `JSON.stringify(undefined)` returns `undefined`, not a
  string, so the plain path cannot represent it. Removal is the intuitive reading and it makes the
  `undefined` codec tag planned for M2 unnecessary — drop it from the M2 codec list.

And two **M7** surfaced:

- **A migration is allowed to mutate the snapshot**, so the write-back compares against a copy
  taken before the migration ran. Comparing against the object the migration was handed made
  `delete previous.token` a no-op — the key was gone from both sides (ADR-022).
- **Versioning costs 0.78 kB** of the budget, all of it paid by stores that never version, because
  the factory reaches the module unconditionally. Making it tree-shakable needs a subpath import
  and a change to the API shape; it is worth revisiting before 1.0 if the budget gets tight.

### After 1.0

- **1.1** — `values()`, `touch()`, `import()`, cookie adapter, opt-in per-key history.
- **2.0** — async core, IndexedDB adapter, Redis adapter, compression plugin.

---

## 11. Quality bar

- **Tests (Vitest).** Env matrix: browser (happy-dom), SSR/Node (no `window`), `SecurityError` on
  property access, Safari-private (`setItem` throws at zero bytes), quota exceeded, corrupt JSON,
  pre-existing raw values, synthetic cross-tab `StorageEvent`. Coverage gate 90% on `packages/core`.
- **Types.** `tsc --strict`, no `any` in the public surface, `expect-type` assertions for inference
  (especially `defaults` → key union and `T[K]`), `@arethetypeswrong/cli` clean.
- **Size (`size-limit`, minified + brotli).** Budgeted per milestone rather than once up front, so
  each milestone has to justify its own weight: after M8, 6.4 kB (actual 6.33; 6.95 with `t.*`).
  **The original 1.0 target of < 6 kB no longer holds** — see the modularity debt below. 1.0 target
  now < 6.5 kB core · `sideEffects: false`
  and subpath exports so unused features tree-shake away.
- **Modularity debt, to be paid before 1.0.** "Never make level 1 pay for level 2 or 3" is a
  non-negotiable, and today it is not true: codecs (M2), TTL (M4), events (M5), migrations (M7) and
  devtools (M8) are all reachable from the factory, so a store that only namespaces still carries
  every one of them. `sideEffects: false` is set and the modules are side-effect free, but nothing
  is subpath-exported, so a bundler has no seam to cut along. Closing this needs either subpath
  entry points (`namespaced-storage/migrate`, `/devtools`) with the factory wiring features in by
  composition, or accepting the size and saying so honestly in the README. **Decide in M12 at the
  latest; it changes the public surface, so it cannot be deferred past 1.0.**
- **Zero runtime dependencies** in `packages/core`.
- **Packaging.** Dual ESM/CJS, exports map (`.`, `./schema`, `./adapters`, `./package.json`),
  `publint` clean, npm provenance on publish.
- **Compatibility.** ES2020 target · Node ≥18 · evergreen browsers · SSR-safe by construction.
