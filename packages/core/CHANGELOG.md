# namespaced-storage

## 1.0.0

### Major Changes

- **1.0.** The API is stable: `createLocalStorage`, `createSessionStorage` and `createMemoryStorage`,
  the store surface they return, the options they take, the error taxonomy, and the on-disk format.
  Anything that changes those from here is a major version.

  Verified on every release: zero runtime dependencies, dual ESM/CJS with types for both, `publint`
  and `@arethetypeswrong/cli` clean for node16 and bundler resolution, the size budgets, and a test
  suite that covers a server runtime with no `window`, a cookie-blocked iframe where property access
  throws, Safari private mode where the first write fails at zero bytes, a full quota, corrupt data,
  pre-existing raw values and cross-tab events.

### Minor Changes

- dc781d3: `subscribe` watches a key, or the whole namespace, in this tab and in others.

  The native `storage` event never fires in the tab that made the change, so local writes are
  emitted alongside it and each event is tagged `source: 'local' | 'remote'`. Values arrive decoded,
  `oldValue` included — it is free on an event and still never written to disk.

  A subscriber that throws is reported as `SubscriberError` and skipped, never taking down the other
  subscribers or the write. A value that fails to decode or validate arrives as `undefined` and is
  reported. A foreign `clear()` reaches whole-namespace subscribers as `key: null`, and per-key
  subscribers as their own key.

- 7798016: Values that JSON cannot represent now survive a round trip, at any depth.

  `Date`, `Map`, `Set`, `BigInt`, `RegExp`, `NaN`, `±Infinity` and nested `undefined` are restored as
  themselves rather than degrading into strings, `{}` or `null`. Types are recorded out of band as
  paths, so the stored payload stays a faithful copy of the value and nothing is injected into user
  data.

  Keys that need none of this still store plain JSON, so existing raw data keeps working and anything
  else reading the key is unaffected.

- `inspect()` prints one `console.table` of a namespace; `export()` returns the same data as a plain
  object. Both ship in every build, production included — a namespace you cannot inspect in
  production is one you cannot debug where it matters.

  In development every store also registers itself on `globalThis.__NAMESPACED_STORAGE__`, so a
  console can reach a store nothing exported to it. That one is development-only on purpose: it holds
  every store on the page alive and hands any script a directory of what the app persists.

- 268efe4: Initial release: the namespacing core (M1).

  - `createLocalStorage` / `createSessionStorage` / `createMemoryStorage`
  - Automatic key prefixing; `clear()` is scoped to the namespace and never calls native `clear()`
  - Nested namespaces via `child()`
  - Automatic JSON serialization, stored in the plain shape so pre-existing raw data stays readable
  - SSR-safe and hostile-environment-safe: blocked iframes, Safari private mode and missing `window`
    fall back to memory instead of throwing
  - Typed errors (`StorageQuotaError`, `StorageUnavailableError`, `DecodeError`, …) and `trySet()`
  - Configurable `fallback`, `onCorrupt`, `onError`, `prefix` and `separator`

- `namespaced-storage/minimal` is a second entry point for code that only namespaces: 5.2 kB against
  the main entry's 6.4 kB, because the typing resolver and the migration engine are never referenced
  and a bundler leaves them out.

  It is the same store with the same semantics — one implementation, wired differently — and it
  refuses `defaults`, `schema`, `version` and `migrate` by name rather than accepting them and doing
  nothing. Move a namespace up a level by changing its import.

- 09675f1: Creating the same namespace twice is now caught, with both call sites named.

  The guard throws outside production and reports through `onError` inside it, so a genuine bug is
  loud in development without ever white-screening a live page. `strict: true` forces the throw
  anywhere, `strict: false` turns it off for deliberate second instances.

  `localStorage` and `sessionStorage` may each hold a namespace of the same name, a memory fallback
  does not change a namespace's identity, and `child()` is never registered. Tests should call the
  new `resetNamespaceRegistry()` export in their setup.

- 013a597: Keys can expire, and can record when they were written.

  `set(key, value, { ttl })` gives one key a lifetime; `ttl` on the store gives every key the same
  one. Expiry is checked on access rather than by a timer, so nothing depends on the tab staying
  open: `get` and `has` collect a dead entry as they pass it, while `keys()`, `size` and `entries()`
  hide it without writing. A key with a default falls back to that default once it expires.

  `timestamps: true` records `createdAt` and `updatedAt`. New readers: `meta(key)` and `ttl(key)`.

- 1b2d8fe: Keys and values can now be typed, with no DSL to learn.

  Pass a plain `defaults` object: its types become the key types, and each read returns a clone of
  the fallback when the key has never been written. For keys with no sensible default, or data that
  must be validated, pass `schema` — either the built-in `t.*` builders or any Standard Schema
  validator (Zod 3.24+, Valibot, ArkType), with no peer dependency and nothing extra in the bundle
  for users who skip it.

  Both options may declare the same key: the schema validates, the default is the fallback, and a
  default contradicting its own schema is rejected at construction. Writes validate and throw
  `ValidationError`; reads follow the new `onInvalid` policy and fall back to the default.

- `version` and `migrate` move a namespace to a new shape without losing what is in it.

  The version lives in one reserved key per namespace, written only once `version` passes 1, so a
  store that never versions never pays a read, a write or a byte for it. `migrate` receives every
  readable key, decoded but deliberately not validated — old data is what a migration exists to see.
  Return the new shape, or return nothing and mutate what you were given.

  Only keys that actually changed are written back, so values carried across untouched keep their
  timestamps and TTL. A migration that throws, returns the wrong shape, or writes a value its own
  schema rejects raises `MigrationError` and leaves the version alone, so the next load retries.
  Storage stamped newer than the code declares is a rolled-back deploy: reported through `onError`,
  never thrown and never downgraded.
