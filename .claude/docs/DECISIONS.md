# Decision log (ADR)

Every non-obvious design choice, with the reasoning and the rejected alternatives.
Append new entries; do not rewrite old ones — supersede them instead.

---

## ADR-001 — Namespace is discipline, not security

**Status:** accepted · **Date:** 2026-09-19

The original goal was "only this instance may write to this namespace." That is not achievable in
client-side JavaScript: any code can construct a second instance with the same namespace string, and
raw `localStorage.setItem('basket:count', …)` always works.

**Decided:** be explicit about this in the README rather than implying a guarantee we cannot keep.
What we actually deliver:

- accidental collisions → eliminated by construction
- `clear()` blast radius → scoped to one namespace
- _accidental_ duplicate namespaces → caught at runtime by a registry guard, and at compile time by
  the registry object literal
- raw access → blocked by the ESLint plugin, which is the only layer that can meaningfully enforce it

**Risk if ignored:** someone treats the namespace as an isolation boundary and stores a secret there.

---

## ADR-002 — Schema at construction, not `.setType()` after the write

**Status:** accepted · **Date:** 2026-09-19 · **Supersedes:** the `set(k,v).setType('number')` sketch

**Rejected:** `basket.set('count', 10).setType('number')`

1. **Temporally backwards.** By the time `.setType()` runs the value is already persisted; the type
   declaration forces a second write, and forgetting the call silently loses the type.
2. **Redundant for most types.** `JSON.parse(JSON.stringify(10)) === 10`. Numbers, strings, booleans,
   `null`, arrays and plain objects already round-trip. Storing `{value:10,type:'number'}` costs
   bytes and buys nothing.
3. **Invisible to TypeScript.** A runtime string argument gives the compiler no information, so the
   stated goal — "be fully type safe" — is not met by it.
4. **Repeated at every call site**, so it drifts between call sites.

**Accepted:** declare the shape once in `createLocalStorage(ns, { schema })`. One declaration yields
compile-time key names, compile-time value types, runtime validation, _and_ correct deserialization.

The real gap `.setType()` was reaching for — types JSON cannot represent (`Date`, `Map`, `Set`,
`BigInt`, `RegExp`, `undefined`) — is solved by codecs driven from the same schema, with the codec tag
persisted in the envelope (ADR-003).

---

## ADR-003 — Smart envelope instead of always-on envelope

**Status:** accepted · **Date:** 2026-09-19

Options considered:

| option                       | interop                                                                          | size                    | complexity                         |
| ---------------------------- | -------------------------------------------------------------------------------- | ----------------------- | ---------------------------------- |
| always plain JSON            | best                                                                             | best                    | cannot carry TTL/codecs/timestamps |
| always envelope              | **breaks** any other reader of the raw key; painful migration from existing data | +40–60 B/key            | lowest                             |
| plain + sidecar metadata key | best                                                                             | 2 writes/key            | metadata can desync from the value |
| **smart/auto**               | best in the common case                                                          | best in the common case | moderate                           |

**Accepted: smart/auto.** Store plain JSON unless a feature demands more (TTL, timestamps, or a
non-JSON-native type). The reader detects the shape via a top-level `__nss` marker.

Collision handling: if a user's own object happens to contain a top-level `__nss`, the encoder is
_forced_ into envelope mode. The round-trip therefore stays exact for every possible input.

Consequence: pre-existing raw values written before adoption are readable, which makes incremental
migration possible. That is the property that makes this package adoptable in the large codebase it
was designed for.

---

## ADR-004 — `oldValue` is an event field, never persisted

**Status:** accepted · **Date:** 2026-09-19

**Rejected:** persisting the previous value alongside the current one.

- Doubles the footprint of every key, permanently, against a ~5 MB budget.
- One level of undo, no history — rarely enough to build a real feature on.
- Security regression: a deleted token or PII survives in `old-value` indefinitely.

**Accepted:** expose `oldValue` on the change event, where the native `storage` event already
provides it for free and in-process writes know it trivially. This covers the realistic use cases
(reacting to a change, diffing) at zero storage cost.

Deferred to v2 as opt-in per key: `history: n`. Never a default.

---

## ADR-005 — `createdAt`/`updatedAt` are opt-in, and exist mainly to enable TTL

**Status:** accepted · **Date:** 2026-09-19

On their own, timestamps are low-value and cost bytes on every key. Their real worth is as the
substrate for expiry, which is a consistently top-requested feature in every storage wrapper.

**Accepted:** `timestamps: false` by default; TTL is a first-class feature built on the same envelope
fields, with lazy expiry checked on read.

---

## ADR-006 — Two API surfaces: sync core and async core

**Status:** accepted · **Date:** 2026-09-19

`localStorage` is synchronous; Redis is not. There is no single honest API for both.

- _All async_ (what `unstorage` does) → `await store.get(k)` is unusable inside a React render. This
  is the single biggest DX weakness of the closest competitor and the main reason this package has
  room to exist.
- _All sync_ → async backends become impossible.

**Accepted:** an adapter declares `kind: 'sync' | 'async'`; the factory returns the matching store
type. Key encoding, codecs, envelope, schema, events and migration are adapter-agnostic shared
modules. Redis in v2 is then a new adapter plus an async shell — no redesign.

---

## ADR-007 — Own mini-schema plus a Standard Schema adapter, no forced validator dependency

**Status:** accepted · **Date:** 2026-09-19

- _Zod as a peer dependency_ → forces a ~13 kB dependency on users who want nothing but namespacing,
  and picks a winner in a field with several good options.
- _TypeScript generics only_ → no runtime validation, so corrupt or stale stored data passes
  silently, and `Date` cannot round-trip.

**Accepted:** ship a small zero-dependency `t.*` builder that covers the common cases and carries the
codec information, and accept any [Standard Schema v1](https://standardschema.dev) validator through
structural detection of the `~standard` property. Zod ≥3.24, Valibot, ArkType and Effect Schema all
work with no peer dependency declared and nothing extra in the bundle for users who skip them.

---

## ADR-008 — Central registry is the recommended pattern

**Status:** ~~accepted~~ **SUPERSEDED by ADR-011** · **Date:** 2026-09-19

Free-standing instances scattered across a codebase reproduce the original problem: nobody can see
what the app persists. A single `storage.registry.ts` fixes exactly that.

Additional property discovered while designing it: because the registry is an object literal,
**duplicate namespaces are already a TypeScript error** — no lint rule required for that case.
This also removes the need for a cross-file duplicate-detection lint rule, which ESLint cannot do
well anyway (rules are per-file). A repo-wide audit CLI is therefore deferred to 1.1 rather than
being load-bearing.

Free-standing `createLocalStorage` stays supported (tests, libraries, incremental adoption); the
`no-unscoped-instance` rule in the `strict` config is what makes the registry mandatory for teams
that want it.

> **Why this was wrong — see ADR-011.** The central object is a merge-conflict hotspot, defeats
> code-splitting, and cannot span packages in a monorepo. Kept here for the record.

---

## ADR-009 — Reads do not throw by default

**Status:** accepted · **Date:** 2026-09-19

Stored data can be corrupt or shaped like an older version of the schema — neither is exceptional in
a long-lived app, and neither should crash a render.

**Accepted:** `onCorrupt` and `onInvalid` default to `'ignore'` (return `undefined`) and always fire
`onError`, so the problem is observable without being fatal. `'remove'` (self-healing) and `'throw'`
(fail fast in tests) are available. Writes still throw, and `trySet()` exists for quota-sensitive
paths.

---

## ADR-010 — Method naming follows `Map`, with native aliases

**Status:** accepted · **Date:** 2026-09-19

**Rejected:** `add()` as the write method. In JavaScript `add` means insert-or-append (`Set.add`);
this operation is an upsert, for which the established name is `set`.

**Accepted:** `set` / `get` / `remove` / `has` / `clear` / `keys` / `entries` / `size`, mirroring
`Map`. `setItem` / `getItem` / `removeItem` are exported as aliases so the migration from raw
`localStorage` is mechanical.

---

## ADR-011 — Co-located definitions; the inventory is generated, not hand-maintained

**Status:** accepted · **Date:** 2026-09-19 · **Supersedes:** ADR-008

A single `defineNamespaces({ ... })` object fails exactly where it was supposed to help — a large
team:

1. **Merge-conflict hotspot.** Every team edits the same file for every change.
2. **Defeats code-splitting.** `import { storage }` pulls every namespace's schema into every bundle,
   even for a route that touches one key.
3. **Impossible in a monorepo.** `basket` and `auth` live in different packages; there is no one file
   they can share.
4. **Ownership is fictional.** `owner: 'team-checkout'` written in a file that team does not own and
   cannot review in isolation.
5. **Unreviewable.** A thousand-line object that every PR touches.

The only thing it genuinely bought was "duplicate object key is a TypeScript error." That is
available far more cheaply.

**Accepted:** each feature declares its own store in a co-located `*.storage.ts` file. The three
governance properties are recovered without the god object:

| property            | how                                                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| duplicate namespace | global runtime registry throws `NamespaceConflictError` naming both creation sites; `nss scan` catches it at CI time **across packages**, which the object literal could not |
| "what do we store?" | `nss scan` generates the inventory from the source. A generated artifact cannot drift; a hand-written one always does                                                        |
| ownership           | `owner` / `description` options next to the code the team actually owns, collected by the scan                                                                               |
| no raw access       | ESLint, unchanged — the only layer that could ever enforce this                                                                                                              |

Consequence: the `nss` CLI is promoted from 1.1 into **1.0**, because it now carries the
discoverability story. `require-namespace-literal` is promoted from warn to **error**, because the
scan depends on it. `defineNamespaces` and `$manifest()` are removed from the design entirely.

---

## ADR-012 — `defaults` is the primary way to declare types; `schema` is the advanced path

**Status:** accepted, with the overlap rule superseded by ADR-015 · **Date:** 2026-09-19 · **Refines:** ADR-007

Requiring `t.number().default(0)` for the simplest possible case means learning a DSL before writing
one key. Most keys need a type and a fallback, not validation.

**Accepted:** a plain JS object is the primary path.

```ts
defaults: { count: 0, items: [] as Item[], lastOpened: new Date() }
```

- Static types are `typeof defaults` — no inference machinery, no new concepts.
- The runtime reads each default's constructor to pick the codec, so `Date` round-trips for free.
- Keys with a default read back as `T`, not `T | undefined`.

`schema` (with `t.*` or any Standard Schema validator) remains for the cases `defaults` cannot
express: a key with no sensible default (`token`), and runtime validation of stored data.

Both may be passed together; the typed key set is their union, and a key in both throws
`InvalidOptionsError` at construction. Two paths are justified here because they answer two different
questions — "what shape is this?" versus "is this data trustworthy?" — and the simple one must not be
taxed by the complex one.

---

## ADR-013 — `createLocalStorage` / `createSessionStorage`, one factory per backend

**Status:** accepted · **Date:** 2026-09-19

Considered: `namespace('basket', { storage: 'local' })` (shorter, one function for all backends) and
`store(...)` (shortest, but collides with state-manager vocabulary — Pinia, Zustand).

**Accepted:** an explicit factory per backend. The call site states which storage it touches without
reading an options object, which matters most in review — the thing a reviewer needs to notice is
"this went to localStorage, so it survives a browser restart." The cost is one export per backend,
which is trivial.

Async backends will follow the same convention (`createRedisStorage`), which also keeps the sync/async
split visible at the call site rather than hidden in a config value.

---

## ADR-014 — Type tags are out-of-band paths, and they apply at any depth

**Status:** accepted · **Date:** 2026-09-19 · **Refines:** ADR-003 (changes the envelope's `t` field)

PLAN.md §6.2 specified a single top-level `t: "date"` on the envelope. Implementing M2 showed that
is only half a solution: it fixes `set('lastOpened', new Date())` but not
`set('user', { lastSeen: new Date() })`, which is the far more common shape. A top-level-only tag
would leave the exact bug the package exists to fix alive one level down.

Two ways to make it deep were considered.

**In-band markers** (replace each special value with `{"__nss_t":"date","v":…}`, as many
serializers do). Rejected: a user object that genuinely contains `__nss_t` cannot be escaped without
either an infinite wrap loop or renaming the user's own keys, and the payload stops being a faithful
copy of the user's structure.

**Out-of-band paths** (accepted, the approach `superjson` uses). The payload stays exactly the
user's structure; the types live beside it:

```json
{
  "__nss": 1,
  "v": { "user": { "lastSeen": 1758297600000 } },
  "t": [[["user", "lastSeen"], "date"]]
}
```

`t` is a list of `[path, tag]` pairs; `[]` is the root. Nothing is ever injected into user data, so
the only collision left is a top-level `__nss`, which ADR-003's force-the-envelope rule already
covers. Revival runs deepest-path-first, so a `Map`'s entries are restored while it is still a plain
array of pairs.

Consequences beyond the original plan:

- **`NaN`, `Infinity` and `-Infinity` are now preserved.** `JSON.stringify` turns all three into
  `null` silently; this is the same class of bug as a lost `Date` and costs nothing extra to fix.
- **Nested `undefined` is preserved** (JSON drops the key). Top-level `undefined` still means
  removal, per the M1 finding — the two are each the intuitive reading in their position.
- **The `undefined` codec tag from the plan is gone** as a top-level concern, as M1 predicted.
- **`toJSON` is honoured**, after the built-in types, matching `JSON.stringify`.
- Cycles are detected per branch, so a shared reference appearing twice is fine and only a genuine
  cycle throws — with the offending path named.

---

## ADR-015 — `defaults` and `schema` may declare the same key

**Status:** accepted · **Date:** 2026-09-19 · **Supersedes:** the overlap rule in ADR-012

ADR-012 said a key appearing in both `defaults` and `schema` throws `InvalidOptionsError`, on the
grounds that two declarations are ambiguous. Implementing M3 showed the opposite: the two options
answer different questions, so overlapping them is the _natural_ combination and forbidding it
leaves a real hole — a key could be validated, or defaulted, but never both. `token` needs
validation without a default; `mode` wants both.

**Accepted:** where a key appears in both, the **schema supplies the type and the validation** and
the **default supplies the fallback**. The schema wins the static type because it is the more
precise statement (`t.enum(['light','dark'])` beats `string` inferred from `'light'`).

The ambiguity ADR-012 feared is handled by checking rather than forbidding: at construction, each
default is run through its own schema, and a contradiction throws `InvalidOptionsError` naming the
key. `defaults: { count: 'zero' }` with `schema: { count: t.number() }` fails immediately instead
of at the first read in production.

Two consequences worth stating:

- **A default also covers a validation failure on read.** Data left over from an older shape reads
  back as the default rather than as `undefined`, which is almost always what the caller wants.
- **`t.*` needs no `.default()` method**, which keeps the built-in schema builder smaller.

---

## ADR-016 — Writes are validated and always throw; reads follow `onInvalid`

**Status:** accepted · **Date:** 2026-09-19

The plan mentioned `onInvalid` only as a read policy. Validating writes as well turned out to be
the more valuable half: it is what actually keeps bad data out of storage, and it costs one
validation pass on a code path that is already doing a `JSON.stringify`.

**Accepted:** `set` validates and throws `ValidationError` (carrying every issue with its path
inside the value), consistent with ADR-009's "writes throw, reads do not". `onInvalid`
(`'ignore'` | `'remove'` | `'throw'`, default `'ignore'`) governs reads only, where the data is
already on disk and a render must not crash.

A typed call site is already checked by the compiler, so runtime write validation is aimed at
untyped callers, JavaScript consumers, and values that pass the type check but fail a refinement
(`z.string().min(10)`).

Related: a Standard Schema validator that returns a `Promise` is rejected with a clear
`InvalidOptionsError` rather than silently treated as valid — a synchronous store cannot await it
(ADR-006).

---

## ADR-017 — Expiry is lazy, and enumeration never writes

**Status:** accepted · **Date:** 2026-09-22

There is no timer to sweep expired keys: a browser tab that is closed before the deadline would
leave them forever, and a background sweep would mean writes the caller never asked for. Expiry is
therefore checked on access.

That raises a question the plan did not: should `keys()`, `size` and `entries()` see expired keys?

- Reporting them is wrong — `keys()` would list a key that `has()` denies.
- Collecting them there means an enumeration silently mutates storage, which is surprising and, in
  a cookie-blocked or read-only context, can fail.

**Accepted:** `get` and `has` are expiry-aware **and collect** the dead entry, since they are
already touching that one key. `keys`, `size` and `entries` **hide** expired entries but never
delete. The two agree on what exists; only the cleanup differs.

The cost of checking is kept near zero by `peekMeta`, which returns early unless the raw string
contains the envelope marker at all. A plain value cannot carry an expiry, so the common case
never pays for a `JSON.parse` — and after ADR-003 most values are plain.

Related detail: with `timestamps: true`, an update has to read the existing entry to keep its
original `createdAt`, so every write costs one extra read. That is why timestamps are off by
default rather than always on.

---

## Open questions

- ~~`get()` on a key absent from both `defaults` and `schema`~~ — settled in M3: a compile error.
  At runtime an undeclared key is simply untyped (no default, no validation) rather than throwing,
  so `entries()` over stale storage keeps working.
- ~~Memory fallback shared or per-instance?~~ — settled in M1: shared per adapter name.
- Should a `t.date()` key coerce a stored ISO string into a `Date`? It would smooth migration off
  raw storage, but silent coercion is hard to reason about. Currently it fails validation and
  `onInvalid` applies.
- `inspect()` in production builds — strip entirely via `NODE_ENV`, or keep behind a flag?
- Should `nss scan` also detect _keys_ (not just namespaces) statically? Keys come from `defaults`
  and `schema` object literals, so it is feasible; the risk is false negatives with computed keys.
