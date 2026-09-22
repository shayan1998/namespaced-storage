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

## ADR-018 — The adapter is the single source of change events

**Status:** accepted · **Date:** 2026-09-22

The native `storage` event has a property that trips people up: **it does not fire in the tab that
made the change.** So covering "tell me when this key changes" needs two sources — the native event
for other tabs, and something local for this one.

Putting the local half in the store would mean every write notifies, and a `child()` or a second
store over the same namespace would each have their own listener list and miss each other's
writes.

**Accepted:** the adapter owns both. `setItem` / `removeItem` emit a local `RawChange`, and the web
adapter additionally listens to the native event for remote ones, tagging each with
`source: 'local' | 'remote'`. Two stores over the same backend therefore observe each other, and
`clear()` produces one event per key for free, because it already goes through `removeItem`.

Details that fall out of this:

- **Filter by `storageArea`.** The `storage` event fires for both localStorage and sessionStorage,
  so without the check a session store would react to a local write that happened to share a key.
- **Capturing `oldValue` costs a read**, so the adapter only does it when something is listening.
- **The native listener is attached on the first subscription and dropped with the last**, so a
  store nobody watches leaks no window listener.

## ADR-019 — What a subscriber is told, and what it can never do

**Status:** accepted · **Date:** 2026-09-22

A change event is delivered from inside the browser's event loop, where a thrown error has nowhere
to go, and it carries raw strings that may not decode.

**Accepted:**

- **A subscriber that throws is caught, reported as `SubscriberError`, and skipped.** It never
  stops the other subscribers, and never stops the write that triggered it.
- **A value that fails to decode or validate is delivered as `undefined` and reported.** The
  listener still learns the key changed, which is the useful half.
- **Defaults are not applied to an event.** `newValue: undefined` means the key was removed. Saying
  "it is now the default" would conflate a removal with a key that happens to have a fallback.
- **A foreign `clear()` arrives as `key: null`.** A whole-namespace subscriber is handed that null
  verbatim; a per-key subscriber is told about _its own_ key instead, because a null it would have
  to interpret is no use to it.

---

## ADR-020 — The conflict guard throws in development and reports in production

**Status:** accepted · **Date:** 2026-09-22 · **Refines:** ADR-011

ADR-011 said a duplicate namespace "throws `NamespaceConflictError` naming both creation sites".
Building it exposed a tension the plan had not weighed: identifying a call site means parsing
`Error.stack`, whose format differs between engines and which minifiers rewrite. A guard that
throws on a signal it cannot always read would crash a production page over a misread stack.

**Accepted:** `strict` defaults to throwing outside production and reporting inside it. Either way
the conflict reaches `onError`, so a monitored app finds out. `strict: true` forces the throw
anywhere; `strict: false` turns the guard off, which is what tests and deliberate second instances
use.

Three rules make the guard trustworthy rather than merely present:

- **An unknown site is never treated as a match.** If the engine will not give us a stack, two
  registrations are reported as a conflict rather than assumed to be the same one. Silence is the
  only failure mode that would make the guard worthless, so it is the one we design against.
- **Identity is `backend::path`, using the _requested_ backend.** `localStorage` and
  `sessionStorage` may each hold a namespace of the same name, and falling back to memory must not
  change what a namespace _is_.
- **The registry lives on `globalThis` under `Symbol.for`**, so it still works when a bundler or a
  pnpm layout puts two copies of this package on one page — the case where a silent collision is
  most likely in the first place.

Children are not registered: nesting is derived, and `basket.child('ui')` twice is ordinary.

### A bug this milestone caught in itself

The first implementation filtered its own stack frames by matching `namespaced-storage/src/`,
which never matches the real layout (`namespaced-storage/packages/core/src/`). Every call therefore
resolved to the _same_ internal frame, every namespace looked like a re-evaluation of itself, and
the guard was completely inert — while the whole suite passed. The tell was that adding the guard
broke nothing. Once fixed it correctly failed 101 existing tests, all of which were re-creating
namespaces across cases. That is what `resetNamespaceRegistry()` is for, and test setup now calls it.

## ADR-021 — A malformed call reports its own mistake first

**Status:** accepted · **Date:** 2026-09-22

When a call is both malformed _and_ duplicates a namespace, the registration used to win, so
`createMemoryStorage('s', { ttl: 0 })` reported a conflict rather than the nonsense ttl.

**Accepted:** the store is constructed — which validates the namespace, the separator, the ttl, and
every default against its schema — and only then is the namespace registered. The specific, local
mistake is the actionable one; the conflict is about the environment and can wait. Construction has
no side effects, so a store built and then discarded costs nothing.

## ADR-022 — A migration is one function over the whole namespace, run once at construction

**Status:** accepted · **Date:** 2026-09-22 · **Implements:** M7

The plan reserved `basket:__nss:meta` for a namespace version and sketched
`migrate(old, fromVersion)`, but left open what `old` is, when the function runs, and what happens
when it fails. Building it forced all three.

**Accepted:**

- **The unit is the namespace, not the key.** There is one version per namespace, so a migration
  receives one snapshot of every readable key — `{ count: 3, token: 'x' }` — and returns the shape
  the namespace should have. Per-key versions would mean a stamp on every entry, which is a tax on
  every write for a feature used a handful of times in a namespace's life.
- **It runs eagerly, at construction, synchronously.** A lazy per-key migration cannot answer "has
  this namespace been migrated?" without reading every key anyway, and the sync API may not await
  (ADR-006). A migration returning a promise is a `MigrationError`, not a silent no-op.
- **It runs after the store is built and the namespace is registered.** Construction validates
  before it has side effects (ADR-021), and a duplicate namespace is found before anything is
  rewritten — two stores over one namespace must not migrate the same data twice.
- **Only keys that changed are written back.** The snapshot is compared by reference
  (`Object.is`), so a migration that copies untouched values keeps their existing timestamps and
  TTL rather than resetting them. Keys the migration dropped are removed; keys it could not read
  (corrupt, and so absent from the snapshot) are left exactly where they are rather than deleted by
  omission.
- **Returning nothing means "I mutated the snapshot".** `(previous) => { delete previous.token }`
  is the shortest correct migration, and requiring a return would make that silently wipe the
  namespace. A return of anything that is not a plain object — an array, `null`, a primitive, a
  promise — is a `MigrationError`, because every one of those is a mistake rather than an intent.

**Failure is loud and leaves the stamp alone.** If the migration throws, returns the wrong shape, or
writes a value its own schema rejects, the version is not advanced and `MigrationError` is both
reported and thrown. The next construction therefore retries from the same version. Sync web
storage has no transaction, so a migration interrupted mid-write (a quota failure on the third of
five keys) replays over partly-new data: migrations should be written to tolerate that, and the
README says so.

**A version going backwards is reported, never enforced.** Storage stamped v3 read by code
declaring v2 is a rolled-back deploy, not a corruption. Throwing would white-screen everyone whose
data is ahead of the code they just received; instead `onError` gets a `MigrationError`, the data
and the stamp are left untouched, and rolling forward again behaves as if nothing happened. The
values themselves still face `onInvalid`, which is the mechanism already designed for data in a
shape the code does not expect.

**Level 1 pays nothing.** With no `version` (or `version: 1`) there is no stamp, no read at
construction and no reserved key — the whole feature is one early return. A `migrate` that could
never run, because `version` is absent or 1, is an `InvalidOptionsError` rather than dead code that
quietly does nothing (ADR-021).

**Children are views, not namespaces.** `basket.child('ui')` shares its parent's options, so
stamping it would write `basket:ui:__nss:meta` and migrate the same data a second time under a
narrower prefix. Only the root store constructed by a factory runs migrations — the same rule
ADR-020 already applies to the conflict guard.

## ADR-023 — Devtools ship in production; the global hook does not

**Status:** accepted · **Date:** 2026-09-22 · **Closes:** open question 3

The plan said `inspect()` would be "stripped in prod builds". Building it made that promise look
worse than the problem it was solving.

**Stripping cannot be done honestly here.** A bundler only removes the code if the guard is the
literal `process.env.NODE_ENV`, which throws `ReferenceError` in a browser that loads the package
without a bundler. Writing it safely — `typeof process === 'undefined' || …` — leaves a runtime
check no minifier can fold, so nothing is removed and we would have paid for the guard as well.
The only real way to strip is to publish separate development and production files, which doubles
the packaging surface that `publint` and `attw` have to stay clean across.

**Accepted:** `inspect()` and `export()` are ordinary methods, present in every build.

- The case for stripping was size. The measured cost is 0.41 kB, and unlike TTL or codecs this is
  not a level 2 feature level 1 is subsidising: "nobody can say what this app persists" is the
  level 1 problem, and `inspect()` is the level 1 answer to it. It is, though, the milestone that
  pushed the core past its 6 kB target — see the modularity note in PLAN §11.
- The case against stripping is that production is where inspection is worth most. Asking someone
  to paste `basket.inspect()` into a console is the shortest path from a bug report to what is
  actually stored, and a build where that is a no-op is the one build you cannot debug.
- `inspect()` renders through the host's `console.table` instead of drawing its own box. The
  browser and Node both already have a table renderer, theirs folds objects open and ours would
  not, and the bytes we do not spend on box drawing are most of why the cost is 0.32 kB.

**`globalThis.__NAMESPACED_STORAGE__` is development-only**, for reasons that are about behaviour
rather than bytes: it holds a reference to every store on the page, which keeps them alive, and it
hands any script in the page a directory of everything the app persists. The check is the existing
runtime `isProduction()` — no minifier needs to understand it, because nothing is being removed.

`export()` returns what `get()` returns, key by key: expired and reserved keys are absent, and a
value failing its schema follows `onInvalid` exactly as a read would. A snapshot that disagreed
with the store it came from would be a worse debugging tool than no snapshot.

## ADR-024 — The lint rules follow imports, not names

**Status:** accepted · **Date:** 2026-09-22 · **Implements:** M9

A lint rule that fires on the _name_ `createLocalStorage` is trivial to write and impossible to
trust: every false positive teaches a team to disable the rule, and a disabled rule protects
nothing.

**Accepted:** `require-namespace-literal`, `no-reserved-key` and `storage-file-convention` only
fire on a call whose callee resolves to an import from `namespaced-storage` — named,
renamed (`createLocalStorage as make`), or reached through a namespace import. A factory
re-exported through a project's own module is invisible to them, and that is the deliberate trade:
the rules under-report rather than cry wolf, and the CLI's `nss scan` is the tool that sees the
whole picture.

`no-direct-storage` is the exception, because there is no import to follow: `localStorage` is a
global. It resolves the identifier **through scope** instead of matching text, so
`function read(localStorage)` and `const localStorage = new Map()` are untouched, and it covers
`window.`, `globalThis.` and `self.` in both dot and bracket form. `document.cookie` is opt-in,
because this package does not own cookies yet.

Three smaller decisions the build forced:

- **Flat configs under the plain names, eslintrc under `legacy-`.** Flat is what ESLint 9 runs, so
  it gets the unqualified name; a project still on eslintrc is the one that knows it needs the
  older shape and can say so.
- **Zero runtime dependencies here too.** The rules are typed against ESLint's own `Rule.RuleModule`
  — ESLint 9 ships its types — rather than `@typescript-eslint/utils`, and the small glob that
  `allowInFiles` and the file convention need is thirty lines in the package. A lint plugin that
  drags in a dependency tree is a lint plugin people skip.
- **A real `Linter` run in the tests, not only `RuleTester`.** `RuleTester` exercises a rule in
  isolation and would happily pass while the exported config that wires it up is malformed. The
  config tests lint a snippet end to end and assert on `ruleId` and severity.

## ADR-025 — A second entry point, `namespaced-storage/minimal`, for level 1

**Status:** accepted · **Date:** 2026-09-22 · **Pays:** the modularity debt recorded in PLAN §11

"Never make level 1 pay for level 2 or 3" had quietly stopped being true. Every feature is reached
from the factory, so `createLocalStorage('basket')` and nothing else still carried the typing
resolver, the migration engine and the devtools global.

**Measured first, because the argument is worth nothing without the numbers.** Stubbing each module
out of a real bundle, brotli, level-1 import:

| build                          | size    | cost of the layer |
| ------------------------------ | ------- | ----------------- |
| everything, including `t.*`    | 6.95 kB |                   |
| today's level 1 (no `t.*`)     | 6.39 kB | —                 |
| − migrations                   | 5.68 kB | 0.71 kB           |
| − typing (`defaults`/`schema`) | 5.20 kB | 0.48 kB           |
| − `inspect()`                  | 4.86 kB | 0.34 kB           |

So the debt is **1.19 kB, 19% of a level-1 bundle** — real, and smaller than the wording of the
non-negotiable suggested. `t.*` was never part of it: it already tree-shakes, which is why the two
existing budgets differ.

**Accepted:** a second entry point, `namespaced-storage/minimal`, exporting the same three
factories wired with nothing above level 1. The default entry does not change at all — same API,
same types, same behaviour, and the existing suite passes untouched, which is what makes this
additive rather than a fork of the package.

- **Composition, not a second implementation.** `makeFactory` takes the features a build supports;
  the two entries differ only in what they hand it. There is one store, one `sync.ts`, one set of
  semantics. A feature that is absent is absent because nothing references it, which is the only
  form of tree-shaking a bundler can be trusted to perform.
- **The minimal build rejects the options it cannot honour.** `defaults`, `schema`, `version` and
  `migrate` throw `InvalidOptionsError` naming the full entry, at construction. A silently ignored
  `migrate` would be exactly the dead code ADR-022 refused to ship.
- **`inspect()` stays.** ADR-023 argued it is the level-1 answer to "nobody can say what this app
  persists", and dropping it here for 0.34 kB would have been that argument admitting it did not
  mean it. The conflict guard stays for the same reason: namespacing as discipline (ADR-001) is
  what level 1 _is_.

**What this does not do.** The codecs (2.5 kB minified, the largest single module after the store
itself) stay in both builds: `basket.set('at', new Date())` reading back a `Date` is a level-1
promise, not an upgrade. A JSON-only build would be a third entry point for a fourth audience, and
one seam is enough.

**If `minimal` turns out to be unused by 1.0, delete it then** — removing an entry point is only
breaking for the people who adopted it, and that is a decision better made with download numbers
than with a principle.

---

## Open questions

- ~~`get()` on a key absent from both `defaults` and `schema`~~ — settled in M3: a compile error.
  At runtime an undeclared key is simply untyped (no default, no validation) rather than throwing,
  so `entries()` over stale storage keeps working.
- ~~Memory fallback shared or per-instance?~~ — settled in M1: shared per adapter name.
- Should a `t.date()` key coerce a stored ISO string into a `Date`? It would smooth migration off
  raw storage, but silent coercion is hard to reason about. Currently it fails validation and
  `onInvalid` applies.
- ~~`inspect()` in production builds~~ — settled in M8: it ships everywhere, and only the global
  hook is development-only. See ADR-023.
- Should `nss scan` also detect _keys_ (not just namespaces) statically? Keys come from `defaults`
  and `schema` object literals, so it is feasible; the risk is false negatives with computed keys.
